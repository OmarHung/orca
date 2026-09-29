import { describe, expect, it } from 'vitest'
import {
  formatPosixCommand,
  isShellSafeSshHost,
  sshVpnProxyCommand,
  sshVpnTerminalProxyOption,
  sshVpnTunnelArgs
} from './ssh-vpn-command-format'

describe('sshVpnTunnelArgs', () => {
  it('bounds only the connect, and passes host and port as arguments', () => {
    expect(sshVpnTunnelArgs('c', 'db.internal', '22')).toEqual([
      'exec',
      '-i',
      '--user',
      'tunnel',
      'c',
      'nc',
      '-w',
      '30',
      'db.internal',
      '22'
    ])
  })
})

describe('isShellSafeSshHost', () => {
  it('accepts names and addresses, and rejects shell syntax and option-like names', () => {
    expect(isShellSafeSshHost('sshd.orca-vpn.test')).toBe(true)
    expect(isShellSafeSshHost('fe80::1%en0')).toBe(true)
    expect(isShellSafeSshHost('$(touch /tmp/x)')).toBe(false)
    expect(isShellSafeSshHost('-oProxyCommand=sh')).toBe(false)
    expect(isShellSafeSshHost('a b')).toBe(false)
  })
})

describe('formatPosixCommand', () => {
  it('quotes only what the shell would split or expand', () => {
    expect(
      formatPosixCommand(['docker', 'sh', '-c', 'umask 077 && base64 -d > "$1"', "it's"])
    ).toBe(`docker sh -c 'umask 077 && base64 -d > "$1"' 'it'\\''s'`)
  })
})

describe('sshVpnProxyCommand', () => {
  it('leaves plain paths bare and quotes the rest for the platform', () => {
    expect(sshVpnProxyCommand('/usr/local/bin/docker', 'c', 'darwin')).toBe(
      '/usr/local/bin/docker exec -i --user tunnel c nc -w 30 %h %p'
    )
    expect(sshVpnProxyCommand('/Users/o b/docker', 'c', 'darwin')).toBe(
      "'/Users/o b/docker' exec -i --user tunnel c nc -w 30 %h %p"
    )
    expect(
      sshVpnProxyCommand(
        'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
        'c',
        'win32'
      )
    ).toBe(
      '"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe" exec -i --user tunnel c nc -w 30 %h %p'
    )
  })
})

describe('sshVpnTerminalProxyOption', () => {
  it('types a single shell word on POSIX, even when the docker path needs quoting', () => {
    expect(
      sshVpnTerminalProxyOption(
        { dockerPath: '/usr/local/bin/docker', containerName: 'c' },
        'darwin'
      )
    ).toBe("-o 'ProxyCommand=/usr/local/bin/docker exec -i --user tunnel c nc -w 30 %h %p'")
    expect(
      sshVpnTerminalProxyOption({ dockerPath: '/Users/o b/docker', containerName: 'c' }, 'linux')
    ).toBe(`-o 'ProxyCommand='\\''/Users/o b/docker'\\'' exec -i --user tunnel c nc -w 30 %h %p'`)
  })

  it('uses docker from PATH inside double quotes on Windows', () => {
    expect(
      sshVpnTerminalProxyOption(
        { dockerPath: 'C:\\Program Files\\Docker\\docker.exe', containerName: 'c' },
        'win32'
      )
    ).toBe('-o "ProxyCommand=docker exec -i --user tunnel c nc -w 30 %h %p"')
  })
})
