import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'

// Test-only: a Docker network reachable only through an OpenVPN server, with an sshd behind it
// that the VPN's own DNS names `sshd.orca-vpn.test`. Used by the vitest integration test and the
// e2e spec; the server's Dockerfile and setup script live in tests/e2e/fixtures/ssh-vpn.

export const VPN_TEST_SSHD_NAME = 'sshd.orca-vpn.test'
/** What the second server (udp/1195) accepts; see tests/e2e/fixtures/ssh-vpn/server-setup.sh. */
export const VPN_TEST_LOGIN = { username: 'orca', password: 'orca-secret' }

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'ssh-vpn')

export type SshVpnTestNetwork = {
  /** Directory holding client.ovpn (inline cert/key, `ca` in a separate file) and the ssh key. */
  profileDir: string
  ovpnPath: string
  /** Same server, but it also asks for VPN_TEST_LOGIN (`auth-user-pass`). */
  loginOvpnPath: string
  sshdIp: string
  privateKeyPath: string
  /** Whether an ordinary container (no VPN) can reach the sshd; must stay false. */
  canReachWithoutVpn: () => Promise<boolean>
  dispose: () => Promise<void>
}

async function docker(args: string[], input?: string): Promise<string> {
  const result = await runProcess({ program: 'docker', args, input, timeoutMs: 300_000 })
  if (result.code !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

async function fixtureImage(): Promise<string> {
  const dockerfile = readFileSync(path.join(FIXTURE_DIR, 'Dockerfile'), 'utf8')
  const digest = createHash('sha256').update(dockerfile).digest('hex').slice(0, 12)
  const image = `orca-ssh-vpn-it:${digest}`
  if ((await runProcess({ program: 'docker', args: ['image', 'inspect', image] })).code !== 0) {
    await docker(['build', '--tag', image, '-'], dockerfile)
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

function writeClientProfile(
  profileDir: string,
  serverIp: string,
  [ca, cert, key]: string[],
  { fileName, port, withLogin }: { fileName: string; port: number; withLogin: boolean }
): string {
  writeFileSync(path.join(profileDir, 'ca.crt'), `${ca}\n`)
  const ovpnPath = path.join(profileDir, fileName)
  writeFileSync(
    ovpnPath,
    [
      'client',
      'dev tun',
      'proto udp',
      `remote ${serverIp} ${port}`,
      ...(withLogin ? ['auth-user-pass'] : []),
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
  return ovpnPath
}

export async function startSshVpnTestNetwork(): Promise<SshVpnTestNetwork> {
  const suffix = randomBytes(4).toString('hex')
  const network = `orca-vpn-it-${suffix}`
  const server = `orca-vpn-it-server-${suffix}`
  const sshd = `orca-vpn-it-sshd-${suffix}`
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'orca-ssh-vpn-it-'))
  const dispose = async (): Promise<void> => {
    await runProcess({ program: 'docker', args: ['rm', '--force', server, sshd] })
    await runProcess({ program: 'docker', args: ['network', 'rm', network] })
    rmSync(profileDir, { recursive: true, force: true })
  }

  try {
    const image = await fixtureImage()
    const privateKeyPath = path.join(profileDir, 'id_ed25519')
    await runProcess({
      program: 'ssh-keygen',
      args: ['-q', '-t', 'ed25519', '-N', '', '-f', privateKeyPath]
    })
    const publicKey = readFileSync(`${privateKeyPath}.pub`, 'utf8').trim()

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
      `AUTHORIZED_KEY=${publicKey}`,
      image,
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
      image,
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
    await docker(
      ['exec', '-i', server, 'sh', '-s', routeNet, routeMask, sshdIp],
      readFileSync(path.join(FIXTURE_DIR, 'server-setup.sh'), 'utf8')
    )
    const pki = await Promise.all(
      ['ca.crt', 'client.crt', 'client.key'].map((file) =>
        docker(['exec', server, 'cat', `/pki/${file}`])
      )
    )

    return {
      profileDir,
      ovpnPath: writeClientProfile(profileDir, serverIp, pki, {
        fileName: 'client.ovpn',
        port: 1194,
        withLogin: false
      }),
      loginOvpnPath: writeClientProfile(profileDir, serverIp, pki, {
        fileName: 'client-login.ovpn',
        port: 1195,
        withLogin: true
      }),
      sshdIp,
      privateKeyPath,
      canReachWithoutVpn: async () => {
        const probe = await runProcess({
          program: 'docker',
          args: ['run', '--rm', image, 'sh', '-c', `sleep 3 | nc -w 2 ${sshdIp} 22`],
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
