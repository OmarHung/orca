import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A Docker network reachable only through an OpenVPN server, with an sshd behind it that the
// VPN's own DNS names `sshd.orca-vpn.test`. Used by the e2e spec and the vitest integration test.

export const VPN_TEST_SSHD_NAME = 'sshd.orca-vpn.test'

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'ssh-vpn')

export type SshVpnTestNetwork = {
  /** Directory holding client.ovpn (inline cert/key, `ca` in a separate file) and the ssh key. */
  profileDir: string
  ovpnPath: string
  sshdIp: string
  privateKeyPath: string
  /** Whether an ordinary container (no VPN) can reach the sshd; must stay false. */
  canReachWithoutVpn: () => boolean
  dispose: () => void
}

function docker(args: string[], input?: string): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: 300_000
  }).trim()
}

function fixtureImage(): string {
  const dockerfile = readFileSync(path.join(FIXTURE_DIR, 'Dockerfile'), 'utf8')
  const image = `orca-ssh-vpn-it:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 12)}`
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
    docker(['build', '--tag', image, '-'], dockerfile)
  }
  return image
}

function cidrToNetAndMask(cidr: string): [string, string] {
  const [net, bits] = cidr.split('/')
  const prefix = Number(bits)
  const mask = [0, 1, 2, 3]
    .map((octet) => 256 - 2 ** (8 - Math.max(0, Math.min(8, prefix - octet * 8))))
    .join('.')
  return [net, mask]
}

export function startSshVpnTestNetwork(): SshVpnTestNetwork {
  const suffix = randomBytes(4).toString('hex')
  const network = `orca-vpn-it-${suffix}`
  const server = `orca-vpn-it-server-${suffix}`
  const sshd = `orca-vpn-it-sshd-${suffix}`
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'orca-ssh-vpn-it-'))
  const dispose = (): void => {
    spawnSync('docker', ['rm', '--force', server, sshd], { stdio: 'ignore' })
    spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' })
    rmSync(profileDir, { recursive: true, force: true })
  }

  try {
    const image = fixtureImage()
    const privateKeyPath = path.join(profileDir, 'id_ed25519')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKeyPath])
    const publicKey = readFileSync(`${privateKeyPath}.pub`, 'utf8').trim()

    docker(['network', 'create', '--internal', network])
    const subnet = docker([
      'network',
      'inspect',
      '--format',
      '{{(index .IPAM.Config 0).Subnet}}',
      network
    ])
    docker([
      'run',
      '--detach',
      '--name',
      sshd,
      '--network',
      network,
      '--env',
      `AUTHORIZED_KEY=${publicKey}`,
      image,
      'sh',
      '-c',
      'ssh-keygen -A >/dev/null && mkdir -p /root/.ssh && echo "$AUTHORIZED_KEY" > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && exec /usr/sbin/sshd -D -e'
    ])
    docker([
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
      image,
      'sleep',
      'infinity'
    ])
    docker(['network', 'connect', network, server])
    const sshdIp = docker([
      'inspect',
      '--format',
      `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
      sshd
    ])
    const serverIp = docker([
      'inspect',
      '--format',
      '{{.NetworkSettings.Networks.bridge.IPAddress}}',
      server
    ])
    const [routeNet, routeMask] = cidrToNetAndMask(subnet)
    docker(
      ['exec', '-i', server, 'sh', '-s', routeNet, routeMask, sshdIp],
      readFileSync(path.join(FIXTURE_DIR, 'server-setup.sh'), 'utf8')
    )

    const [ca, cert, key] = ['ca.crt', 'client.crt', 'client.key'].map((file) =>
      docker(['exec', server, 'cat', `/pki/${file}`])
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

    return {
      profileDir,
      ovpnPath,
      sshdIp,
      privateKeyPath,
      canReachWithoutVpn: () => {
        const probe = spawnSync(
          'docker',
          ['run', '--rm', image, 'sh', '-c', `sleep 3 | nc -w 2 ${sshdIp} 22`],
          { encoding: 'utf8', timeout: 60_000 }
        )
        return (probe.stdout ?? '').includes('SSH-2.0')
      },
      dispose
    }
  } catch (error) {
    dispose()
    throw error
  }
}
