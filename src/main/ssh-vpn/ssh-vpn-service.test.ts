import { describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import type { SshVpnProfile } from '../../shared/ssh-vpn-types'
import { createResolvedConfig } from '../ssh/ssh-connection-test-fixtures'
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
  const store = { profileForTarget: vi.fn(() => profile) }
  const manager = {
    acquire: vi.fn(async () => ROUTE),
    getReadyRoute: vi.fn(() => (ready ? ROUTE : null))
  }
  const service = new SshVpnService(store, manager)
  return { service, manager }
}

describe('SshVpnService', () => {
  it('leaves hosts without a VPN alone', async () => {
    const { service, manager } = createService(null)

    await expect(service.prepare(target(), null)).resolves.toBeNull()
    expect(service.proxyCommand(target())).toBeNull()
    expect(manager.acquire).not.toHaveBeenCalled()
  })

  it('starts the VPN and connects through nc in its container', async () => {
    const { service, manager } = createService(PROFILE)

    await expect(service.prepare(target(), null)).resolves.toEqual({
      kind: 'argv',
      program: '/usr/local/bin/docker',
      args: ['exec', '-i', 'orca-ssh-vpn-t-p', 'nc', '-w', '30', '%h', '%p']
    })
    expect(manager.acquire).toHaveBeenCalledWith(PROFILE)
    expect(service.proxyCommand(target())).toBe(
      '/usr/local/bin/docker exec -i orca-ssh-vpn-t-p nc -w 30 %h %p'
    )
  })

  it('refuses hosts that already use ProxyJump or ProxyCommand, including from ~/.ssh/config', async () => {
    const { service, manager } = createService(PROFILE)
    const resolved = createResolvedConfig({ proxyJump: 'bastion' })

    await expect(service.prepare(target({ jumpHost: 'bastion' }), null)).rejects.toThrow(
      /already connects through ProxyJump or ProxyCommand/
    )
    await expect(
      service.prepare(target({ source: 'ssh-config', configHost: 'db' }), resolved)
    ).rejects.toThrow(/already connects through ProxyJump or ProxyCommand/)
    expect(manager.acquire).not.toHaveBeenCalled()
  })

  it('fails closed for system ssh when the host has a VPN that is not up', () => {
    const { service } = createService(PROFILE, false)

    expect(() => service.proxyCommand(target())).toThrow(
      'VPN "Office" is not connected, so Orca will not connect to this host'
    )
  })
})
