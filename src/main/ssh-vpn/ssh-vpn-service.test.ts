import { describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import type { SshVpnProfile } from '../../shared/ssh-vpn-types'
import { createResolvedConfig } from '../ssh/ssh-connection-test-fixtures'
import {
  SshVpnStartDeclinedError,
  type SshVpnStartConfirm,
  type SshVpnStartOptions
} from './ssh-vpn-manager-types'
import { SshVpnService, type SshVpnStartApproval } from './ssh-vpn-service'

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
    getProfile: vi.fn(() => profile),
    setAssignment: vi.fn()
  }
  const manager = {
    acquire: vi.fn(async (_profile: SshVpnProfile, options?: { confirm?: SshVpnStartConfirm }) => {
      await options?.confirm?.(['docker run …'])
      return ROUTE
    }),
    getReadyRoute: vi.fn(() => (ready ? ROUTE : null))
  }
  const approveStart = vi.fn(async () => ({ approved: true }))
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
      args: ['exec', '-i', '--user', 'tunnel', 'orca-ssh-vpn-t-p', 'nc', '%h', '%p']
    })
    expect(approveStart).toHaveBeenCalledWith({
      profile: PROFILE,
      hostLabel: 'db',
      switchable: true,
      commands: ['docker run …']
    })
    expect(service.proxyCommand(target())).toBe(
      '/usr/local/bin/docker exec -i --user tunnel orca-ssh-vpn-t-p nc %h %p'
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

    expect(approveStart).toHaveBeenCalledWith(
      expect.objectContaining({ hostLabel: null, switchable: false })
    )
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
        getProfile: () => null,
        setAssignment: () => undefined
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

const OTHER: SshVpnProfile = {
  id: 'profile-0002',
  name: 'Pingtung',
  ovpnPath: '/vpn/pingtung.ovpn',
  idleMinutes: 10
}

const commandsFor = (profile: SshVpnProfile): string[] => [`docker run ${profile.id}`]

/** Two profiles, the host on PROFILE; the manager asks with each profile's own commands. */
function createSwitchingService(
  answers: Awaited<ReturnType<SshVpnStartApproval>>[],
  /** Runs once before the first confirm, e.g. another connection's switch landing meanwhile. */
  beforeFirstConfirm?: (store: { setAssignment: (t: string, p: string | null) => void }) => void
) {
  const profiles = [PROFILE, OTHER]
  let assigned = PROFILE.id
  const store = {
    profileForTarget: vi.fn(() => profiles.find((profile) => profile.id === assigned) ?? null),
    getProfile: vi.fn((id: string) => profiles.find((profile) => profile.id === id) ?? null),
    setAssignment: vi.fn((_targetId: string, profileId: string | null) => {
      assigned = profileId ?? ''
    })
  }
  const started: string[] = []
  const manager = {
    acquire: vi.fn(async (profile: SshVpnProfile, options?: SshVpnStartOptions) => {
      beforeFirstConfirm?.(store)
      beforeFirstConfirm = undefined
      if (options?.confirm && !(await options.confirm(commandsFor(profile)))) {
        throw new SshVpnStartDeclinedError(`VPN "${profile.name}" was not started`)
      }
      started.push(profile.id)
      return { ...ROUTE, containerName: `ctr-${profile.id}` }
    }),
    getReadyRoute: vi.fn(() => null)
  }
  const approveStart = vi.fn<SshVpnStartApproval>(
    async () => answers.shift() ?? { approved: false }
  )
  const onAssignmentChanged = vi.fn()
  const service = new SshVpnService({ store, manager, approveStart, onAssignmentChanged })
  return { service, store, started, approveStart, onAssignmentChanged }
}

describe('SshVpnService switching VPNs from the start confirmation', () => {
  it('moves the host to the picked VPN and starts it with the commands already approved', async () => {
    const { service, store, started, approveStart, onAssignmentChanged } = createSwitchingService([
      { approved: true, switchTo: { profileId: OTHER.id, commands: commandsFor(OTHER) } }
    ])

    await expect(service.prepareTerminal(target(), null)).resolves.toEqual({
      profileName: 'Pingtung',
      dockerPath: ROUTE.dockerPath,
      containerName: `ctr-${OTHER.id}`
    })
    expect(store.setAssignment).toHaveBeenCalledWith('target-a', OTHER.id)
    expect(onAssignmentChanged).toHaveBeenCalledOnce()
    expect(started).toEqual([OTHER.id])
    expect(approveStart).toHaveBeenCalledOnce()
  })

  it('asks again when the picked VPN would now run other commands than the ones shown', async () => {
    const { service, started, approveStart } = createSwitchingService([
      { approved: true, switchTo: { profileId: OTHER.id, commands: [] } },
      { approved: true }
    ])

    await service.prepare(target(), null)

    expect(approveStart).toHaveBeenCalledTimes(2)
    expect(approveStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ profile: OTHER, commands: commandsFor(OTHER) })
    )
    expect(started).toEqual([OTHER.id])
  })

  it('keeps the host on its VPN when the user cancels after picking another', async () => {
    const { service, store, started } = createSwitchingService([
      { approved: false, switchTo: { profileId: OTHER.id, commands: commandsFor(OTHER) } }
    ])

    await expect(service.prepare(target(), null)).rejects.toThrow(SshVpnStartDeclinedError)
    expect(store.setAssignment).not.toHaveBeenCalled()
    expect(started).toEqual([])
  })

  it('asks about the same VPN again when the picked one was deleted meanwhile', async () => {
    const { service, store, started, approveStart } = createSwitchingService([
      { approved: true, switchTo: { profileId: 'profile-gone', commands: [] } },
      { approved: true }
    ])

    await service.prepare(target(), null)

    expect(store.setAssignment).not.toHaveBeenCalled()
    expect(approveStart).toHaveBeenLastCalledWith(expect.objectContaining({ profile: PROFILE }))
    expect(started).toEqual([PROFILE.id])
  })

  it('does not ask about the VPN a host just left for a start queued behind the switch', async () => {
    const { service, started, approveStart } = createSwitchingService(
      [{ approved: true }],
      (store) => store.setAssignment('target-a', OTHER.id)
    )

    await service.prepare(target(), null)

    expect(approveStart).toHaveBeenCalledOnce()
    expect(approveStart).toHaveBeenCalledWith(expect.objectContaining({ profile: OTHER }))
    expect(started).toEqual([OTHER.id])
  })

  it('never switches a manual or database connect, which names its VPN itself', async () => {
    const { service, store, started } = createSwitchingService([
      { approved: true, switchTo: { profileId: OTHER.id, commands: commandsFor(OTHER) } }
    ])

    await expect(service.connect(PROFILE.id, 'orders-db')).rejects.toThrow(SshVpnStartDeclinedError)
    expect(store.setAssignment).not.toHaveBeenCalled()
    expect(started).toEqual([])
  })
})
