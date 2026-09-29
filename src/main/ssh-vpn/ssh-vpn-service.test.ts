import { describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import type { SshVpnProfile } from '../../shared/ssh-vpn-types'
import { createResolvedConfig } from '../ssh/ssh-connection-test-fixtures'
import type { SshVpnStartConfirm } from './ssh-vpn-manager-types'
import { SshVpnService } from './ssh-vpn-service'

const PROFILE: SshVpnProfile = {
  id: 'profile-0001',
  name: 'Office',
  ovpnPath: '/vpn/office.ovpn',
  idleMinutes: 10
}
const ROUTE = { dockerPath: '/usr/local/bin/docker', containerName: 'orca-ssh-vpn-t-p' }

function target(overrides: Partial<SshTarget> = {}): SshTarget {
  return {
    id: 'target-a',
    label: 'db',
    host: 'db.internal',
    port: 22,
    username: 'deploy',
    ...overrides
  }
}

function createService(profile: SshVpnProfile | null, ready = true) {
  const store = {
    profileForTarget: vi.fn(() => profile),
    getProfile: vi.fn(() => profile)
  }
  const manager = {
    acquire: vi.fn(async (_profile: SshVpnProfile, options?: { confirm?: SshVpnStartConfirm }) => {
      await options?.confirm?.(['docker run …'])
      return ROUTE
    }),
    getReadyRoute: vi.fn(() => (ready ? ROUTE : null))
  }
  const approveStart = vi.fn(async () => true)
  const service = new SshVpnService({ store, manager, approveStart, platform: 'darwin' })
  return { service, manager, approveStart }
}

describe('SshVpnService', () => {
  it('leaves hosts without a VPN alone', async () => {
    const { service, manager } = createService(null)

    await expect(service.prepare(target(), null)).resolves.toBeNull()
    await expect(service.prepareTerminal(target(), null)).resolves.toBeNull()
    expect(service.proxyCommand(target())).toBeNull()
    expect(manager.acquire).not.toHaveBeenCalled()
  })

  it('asks the user naming the host, then connects through nc in the container', async () => {
    const { service, approveStart } = createService(PROFILE)

    await expect(service.prepare(target(), null)).resolves.toEqual({
      kind: 'argv',
      program: '/usr/local/bin/docker',
      args: ['exec', '-i', '--user', 'tunnel', 'orca-ssh-vpn-t-p', 'nc', '-w', '30', '%h', '%p']
    })
    expect(approveStart).toHaveBeenCalledWith({
      profile: PROFILE,
      hostLabel: 'db',
      commands: ['docker run …']
    })
    expect(service.proxyCommand(target())).toBe(
      '/usr/local/bin/docker exec -i --user tunnel orca-ssh-vpn-t-p nc -w 30 %h %p'
    )
  })

  it('gives the SSH page the route and profile name for its terminal command', async () => {
    const { service } = createService(PROFILE)

    await expect(service.prepareTerminal(target(), null)).resolves.toEqual({
      profileName: 'Office',
      ...ROUTE
    })
  })

  it('asks without a host for a manual connect', async () => {
    const { service, approveStart } = createService(PROFILE)

    await service.connect(PROFILE.id)

    expect(approveStart).toHaveBeenCalledWith(expect.objectContaining({ hostLabel: null }))
  })

  it('refuses hosts that already use ProxyJump or ProxyCommand, including from ~/.ssh/config', async () => {
    const { service, manager } = createService(PROFILE)
    const resolved = createResolvedConfig({ proxyJump: 'bastion' })

    await expect(service.prepare(target({ jumpHost: 'bastion' }), null)).rejects.toThrow(
      /already connects through ProxyJump or ProxyCommand/
    )
    await expect(
      service.prepareTerminal(target({ source: 'ssh-config', configHost: 'db' }), resolved)
    ).rejects.toThrow(/already connects through ProxyJump or ProxyCommand/)
    expect(manager.acquire).not.toHaveBeenCalled()
  })

  it('refuses host names a shell would expand, since OpenSSH puts %h into a shell command', async () => {
    const { service, manager } = createService(PROFILE)

    await expect(service.prepare(target({ host: '$(touch /tmp/x)' }), null)).rejects.toThrow(
      /cannot pass through the VPN safely/
    )
    expect(manager.acquire).not.toHaveBeenCalled()
  })

  it("keys connection reuse by the host's VPN, and never matches a direct route when unreadable", () => {
    expect(createService(PROFILE).service.routeKey(target())).toBe(PROFILE.id)
    expect(createService(null).service.routeKey(target())).toBe('')
    const unreadable = new SshVpnService({
      store: {
        profileForTarget: () => {
          throw new Error('not valid JSON')
        },
        getProfile: () => null
      },
      manager: createService(PROFILE).manager
    })
    expect(unreadable.routeKey(target())).toBe('unreadable')
  })

  it('fails closed for system ssh when the host has a VPN that is not up', () => {
    const { service } = createService(PROFILE, false)

    expect(() => service.proxyCommand(target())).toThrow(
      'VPN "Office" is not connected, so Orca will not connect to this host'
    )
  })
})
