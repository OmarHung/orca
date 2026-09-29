import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('child_process', () => ({ spawn: spawnMock }))

import { spawnProxyCommand } from '../ssh/ssh-proxy-command'
import { buildSshArgs } from '../ssh/system-ssh-args'
import { setSshVpnRouteProvider } from './ssh-vpn-route'

function createProxyProcess(): EventEmitter & Record<'stdin' | 'stdout' | 'stderr', EventEmitter> {
  return Object.assign(new EventEmitter(), {
    stdin: new EventEmitter(),
    stdout: Object.assign(new EventEmitter(), { pause: vi.fn(), resume: vi.fn() }),
    stderr: new EventEmitter()
  })
}

const TARGET: SshTarget = {
  id: 'target-a',
  label: 'db',
  configHost: 'db',
  source: 'ssh-config',
  host: 'db.internal',
  port: 22,
  username: 'deploy'
}

describe('argv proxies', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('runs the program without a shell and substitutes only whole %h/%p arguments', () => {
    spawnMock.mockReturnValue(createProxyProcess())

    spawnProxyCommand(
      {
        kind: 'argv',
        program: '/usr/local/bin/docker',
        args: ['exec', '-i', 'c', 'nc', '%h', '%p', 'x%h']
      },
      'db.internal; rm -rf /',
      2222,
      'deploy'
    )

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/docker',
      ['exec', '-i', 'c', 'nc', 'db.internal; rm -rf /', '2222', 'x%h'],
      expect.objectContaining({ shell: false })
    )
  })
})

describe('buildSshArgs with a VPN route provider', () => {
  afterEach(() => {
    setSshVpnRouteProvider(null)
  })

  it('adds the VPN ProxyCommand before the destination, even for config-backed hosts', () => {
    setSshVpnRouteProvider({
      prepare: vi.fn(),
      proxyCommand: () => '/usr/local/bin/docker exec -i c nc %h %p'
    })

    const args = buildSshArgs(TARGET)

    const option = args.indexOf('ProxyCommand=/usr/local/bin/docker exec -i c nc %h %p')
    expect(args[option - 1]).toBe('-o')
    expect(option).toBeLessThan(args.indexOf('--'))
  })

  it('fails closed instead of dialling the host directly when the VPN is down', () => {
    setSshVpnRouteProvider({
      prepare: vi.fn(),
      proxyCommand: () => {
        throw new Error('VPN "Office" is not connected, so Orca will not connect to this host')
      }
    })

    expect(() => buildSshArgs(TARGET)).toThrow('VPN "Office" is not connected')
  })

  it('leaves the arguments untouched without a provider or an assignment', () => {
    const withoutProvider = buildSshArgs(TARGET)
    setSshVpnRouteProvider({ prepare: vi.fn(), proxyCommand: () => null })

    expect(buildSshArgs(TARGET)).toEqual(withoutProvider)
    expect(withoutProvider.some((arg) => arg.startsWith('ProxyCommand='))).toBe(false)
  })
})
