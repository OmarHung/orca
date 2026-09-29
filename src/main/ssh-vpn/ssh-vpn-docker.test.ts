import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '../../shared/child-process/run-process'
import {
  dockerOpenVpnArgs,
  dockerRunArgs,
  dockerTunnelArgs,
  dockerWriteFileArgs,
  SshVpnDocker,
  sshVpnContainerName,
  sshVpnProxyCommand
} from './ssh-vpn-docker'
import { SSH_VPN_DOCKERFILE, SSH_VPN_IMAGE } from './ssh-vpn-image'

function result(partial: Partial<ProcessResult>): ProcessResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, ...partial }
}

describe('docker argv builders', () => {
  it('starts a labelled, capability-limited container with an in-memory profile directory', () => {
    const name = sshVpnContainerName('abcd1234', 'profile-1')
    const args = dockerRunArgs(name, 'abcd1234', 'profile-1')

    expect(name).toBe('orca-ssh-vpn-abcd1234-profile-1')
    expect(args).toEqual(
      expect.arrayContaining([
        '--rm',
        '--init',
        'dev.orca.ssh-vpn.instance=abcd1234',
        'NET_ADMIN',
        '/dev/net/tun',
        '/run/orca:rw,mode=0700',
        SSH_VPN_IMAGE
      ])
    )
    // Why: nothing is published, so only `docker exec` can reach the tunnel.
    expect(args.some((arg) => arg === '-p' || arg.startsWith('--publish'))).toBe(false)
  })

  it('passes paths as arguments rather than splicing them into a shell string', () => {
    expect(dockerWriteFileArgs('c', '/run/orca/f0-ca.crt')).toEqual([
      'exec',
      '-i',
      'c',
      'sh',
      '-c',
      'umask 077 && base64 -d > "$1"',
      'sh',
      '/run/orca/f0-ca.crt'
    ])
    expect(dockerTunnelArgs('c', 'db.internal', '22')).toEqual([
      'exec',
      '-i',
      'c',
      'nc',
      'db.internal',
      '22'
    ])
  })

  it('puts Orca options after --config so the profile cannot override them', () => {
    const args = dockerOpenVpnArgs('c')
    expect(args.indexOf('--up')).toBeGreaterThan(args.indexOf('--config'))
    expect(args.indexOf('--script-security')).toBeGreaterThan(args.indexOf('--config'))
  })
})

describe('sshVpnProxyCommand', () => {
  it('leaves plain paths bare and quotes the rest for the platform', () => {
    expect(sshVpnProxyCommand('/usr/local/bin/docker', 'c', 'darwin')).toBe(
      '/usr/local/bin/docker exec -i c nc %h %p'
    )
    expect(sshVpnProxyCommand('/Users/o b/docker', 'c', 'darwin')).toBe(
      "'/Users/o b/docker' exec -i c nc %h %p"
    )
    expect(
      sshVpnProxyCommand(
        'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
        'c',
        'win32'
      )
    ).toBe('"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe" exec -i c nc %h %p')
  })
})

describe('SshVpnDocker', () => {
  it('builds the image from the embedded Dockerfile only when it is missing', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result({ code: 1, stderr: 'No such image' }))
      .mockResolvedValueOnce(result({}))
    const docker = new SshVpnDocker('/usr/local/bin/docker', run)

    await docker.ensureImage()

    expect(run).toHaveBeenNthCalledWith(1, ['image', 'inspect', SSH_VPN_IMAGE])
    expect(run).toHaveBeenNthCalledWith(2, ['build', '--tag', SSH_VPN_IMAGE, '-'], {
      input: SSH_VPN_DOCKERFILE,
      timeoutMs: 600_000
    })
  })

  it('reports docker failures with the first stderr line', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        result({ code: 1, stderr: 'Cannot connect to the Docker daemon\nmore detail' })
      )
    const docker = new SshVpnDocker('/usr/local/bin/docker', run)

    await expect(docker.assertRunning()).rejects.toThrow(
      /Docker is not running.*: Cannot connect to the Docker daemon$/
    )
  })

  it('writes files as base64 on stdin', async () => {
    const run = vi.fn().mockResolvedValue(result({}))
    const docker = new SshVpnDocker('/usr/local/bin/docker', run)

    await docker.writeFile('c', '/run/orca/profile.ovpn', Buffer.from([0, 255, 1]))

    expect(run).toHaveBeenCalledWith(dockerWriteFileArgs('c', '/run/orca/profile.ovpn'), {
      input: 'AP8B'
    })
  })

  it('counts one tunnel per nc process and treats no match as zero', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result({ stdout: '12\n34\n' }))
      .mockResolvedValueOnce(result({ code: 1 }))
      .mockResolvedValueOnce(result({ code: 125, stderr: 'No such container: c' }))
    const docker = new SshVpnDocker('/usr/local/bin/docker', run)

    await expect(docker.countTunnels('c')).resolves.toBe(2)
    await expect(docker.countTunnels('c')).resolves.toBe(0)
    await expect(docker.countTunnels('c')).rejects.toThrow('No such container: c')
  })
})
