import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { utils as sshUtils } from 'ssh2'
import { runProcess } from '../../shared/child-process/run-process'

// Test-only: a Docker network that is reachable solely through an OpenVPN server, with an sshd
// behind it that the VPN's own DNS names `sshd.orca-vpn.test`.

const FIXTURE_IMAGE_DOCKERFILE = [
  'FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8',
  'RUN apk add --no-cache openvpn openssl iptables dnsmasq openssh-server',
  ''
].join('\n')
const FIXTURE_IMAGE = 'orca-ssh-vpn-it:1'

export const TEST_SSHD_NAME = 'sshd.orca-vpn.test'

/** Runs inside the VPN server: PKI, server config, NAT onto the internal network, DNS. */
const SERVER_SETUP = String.raw`set -e
ROUTE_NET="$1"; ROUTE_MASK="$2"; SSHD_IP="$3"
mkdir -p /pki && cd /pki
for role in ca server client; do openssl ecparam -name prime256v1 -genkey -noout -out "$role.key"; done
openssl req -x509 -new -key ca.key -sha256 -days 2 -subj /CN=orca-it-ca -out ca.crt 2>/dev/null
for role in server client; do
  openssl req -new -key $role.key -subj /CN=$role -out $role.csr 2>/dev/null
  eku=serverAuth; [ $role = client ] && eku=clientAuth
  printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyAgreement\nextendedKeyUsage=%s\n' $eku > $role.ext
  openssl x509 -req -in $role.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -sha256 -extfile $role.ext -out $role.crt 2>/dev/null
done
cat > /server.conf <<CONF
port 1194
proto udp
dev tun
ca /pki/ca.crt
cert /pki/server.crt
key /pki/server.key
dh none
topology subnet
server 10.99.0.0 255.255.255.0
push "route $ROUTE_NET $ROUTE_MASK"
push "dhcp-option DNS 10.99.0.1"
push "dhcp-option DOMAIN orca-vpn.test"
keepalive 10 60
verb 3
CONF
iptables -t nat -A POSTROUTING -s 10.99.0.0/24 ! -o tun0 -j MASQUERADE
openvpn --config /server.conf --daemon --log /openvpn.log
i=0; until grep -q 'Initialization Sequence Completed' /openvpn.log; do i=$((i+1)); [ $i -gt 50 ] && exit 1; sleep 0.2; done
dnsmasq --listen-address=10.99.0.1 --bind-dynamic --no-resolv --local=/orca-vpn.test/ --host-record=${TEST_SSHD_NAME},$SSHD_IP
`

async function docker(args: string[], input?: string): Promise<string> {
  const result = await runProcess({ program: 'docker', args, input, timeoutMs: 300_000 })
  if (result.code !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function cidrToNetAndMask(cidr: string): [string, string] {
  const [net, bits] = cidr.split('/')
  const prefix = Number(bits)
  const mask = [0, 1, 2, 3]
    .map((octet) => {
      const ones = Math.max(0, Math.min(8, prefix - octet * 8))
      return 256 - 2 ** (8 - ones)
    })
    .join('.')
  return [net, mask]
}

export type SshVpnTestNetwork = {
  /** Directory holding client.ovpn (inline cert/key) and the ca.crt it references. */
  profileDir: string
  ovpnPath: string
  sshdIp: string
  privateKey: string
  privateKeyPath: string
  /** Containers must never be reachable this way; used to prove the negative. */
  canReachWithoutVpn: () => Promise<boolean>
  dispose: () => Promise<void>
}

export async function startSshVpnTestNetwork(): Promise<SshVpnTestNetwork> {
  const suffix = randomBytes(4).toString('hex')
  const network = `orca-vpn-it-${suffix}`
  const server = `orca-vpn-it-server-${suffix}`
  const sshd = `orca-vpn-it-sshd-${suffix}`
  const profileDir = mkdtempSync(path.join(tmpdir(), 'orca-ssh-vpn-it-'))
  const dispose = async (): Promise<void> => {
    await runProcess({ program: 'docker', args: ['rm', '--force', server, sshd] })
    await runProcess({ program: 'docker', args: ['network', 'rm', network] })
    rmSync(profileDir, { recursive: true, force: true })
  }

  try {
    if (
      (await runProcess({ program: 'docker', args: ['image', 'inspect', FIXTURE_IMAGE] })).code !==
      0
    ) {
      await docker(['build', '--tag', FIXTURE_IMAGE, '-'], FIXTURE_IMAGE_DOCKERFILE)
    }
    const keys = sshUtils.generateKeyPairSync('ed25519')
    await docker(['network', 'create', '--internal', network])
    const subnet = await docker([
      'network',
      'inspect',
      '--format',
      '{{(index .IPAM.Config 0).Subnet}}',
      network
    ])
    await docker([
      'run',
      '--detach',
      '--name',
      sshd,
      '--network',
      network,
      '--env',
      `AUTHORIZED_KEY=${keys.public}`,
      FIXTURE_IMAGE,
      'sh',
      '-c',
      'ssh-keygen -A >/dev/null && mkdir -p /root/.ssh && echo "$AUTHORIZED_KEY" > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && exec /usr/sbin/sshd -D -e'
    ])
    await docker([
      'run',
      '--detach',
      '--name',
      server,
      '--cap-add',
      'NET_ADMIN',
      '--device',
      '/dev/net/tun',
      '--sysctl',
      'net.ipv4.ip_forward=1',
      FIXTURE_IMAGE,
      'sleep',
      'infinity'
    ])
    await docker(['network', 'connect', network, server])
    const sshdIp = await docker([
      'inspect',
      '--format',
      `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
      sshd
    ])
    const serverIp = await docker([
      'inspect',
      '--format',
      '{{.NetworkSettings.Networks.bridge.IPAddress}}',
      server
    ])
    const [routeNet, routeMask] = cidrToNetAndMask(subnet)
    await docker(['exec', '-i', server, 'sh', '-s', routeNet, routeMask, sshdIp], SERVER_SETUP)

    const [ca, cert, key] = await Promise.all(
      ['ca.crt', 'client.crt', 'client.key'].map((file) =>
        docker(['exec', server, 'cat', `/pki/${file}`])
      )
    )
    writeFileSync(path.join(profileDir, 'ca.crt'), `${ca}\n`)
    const ovpnPath = path.join(profileDir, 'client.ovpn')
    writeFileSync(
      ovpnPath,
      [
        'client',
        'dev tun',
        'proto udp',
        `remote ${serverIp} 1194`,
        'nobind',
        'remote-cert-tls server',
        'verb 3',
        'ca ca.crt',
        '<cert>',
        cert,
        '</cert>',
        '<key>',
        key,
        '</key>',
        ''
      ].join('\n')
    )
    const privateKeyPath = path.join(profileDir, 'id_ed25519')
    writeFileSync(privateKeyPath, keys.private, { mode: 0o600 })

    return {
      profileDir,
      ovpnPath,
      sshdIp,
      privateKey: keys.private,
      privateKeyPath,
      canReachWithoutVpn: async () => {
        const probe = await runProcess({
          program: 'docker',
          args: ['run', '--rm', '-i', FIXTURE_IMAGE, 'sh', '-c', `sleep 3 | nc -w 2 ${sshdIp} 22`],
          timeoutMs: 60_000
        })
        return probe.stdout.includes('SSH-2.0')
      },
      dispose
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
