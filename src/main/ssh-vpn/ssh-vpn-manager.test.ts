import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '../../shared/child-process/process-spec'
import type { SshVpnProfile, SshVpnProfileState } from '../../shared/ssh-vpn-types'
import { SshVpnManager } from './ssh-vpn-manager'
import type { SshVpnDockerPort } from './ssh-vpn-manager-types'

const PROFILE: SshVpnProfile = {
  id: 'profile-0001',
  name: 'Office',
  ovpnPath: '/vpn/office.ovpn',
  idleMinutes: 10
}
const CONTAINER = 'orca-ssh-vpn-tag12345-profile-0001'
const READY = '2026-09-29 10:00:00 Initialization Sequence Completed\n'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { end: () => void }
  kill: () => boolean
}

function createFakeDocker(script: string[][] = [[READY]]) {
  const children: FakeChild[] = []
  const docker = {
    dockerPath: '/usr/local/bin/docker',
    assertRunning: vi.fn(async () => undefined),
    hasImage: vi.fn(async () => true),
    buildImage: vi.fn(async () => undefined),
    startContainer: vi.fn(async () => undefined),
    applyFirewall: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    countTunnels: vi.fn(async () => 0),
    remove: vi.fn(async () => undefined),
    listContainers: vi.fn(async (): Promise<string[]> => []),
    query: vi.fn(async (_args: readonly string[]): Promise<ProcessResult> => ({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })),
    spawnOpenVpn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: { end: vi.fn() },
        kill: vi.fn(() => {
          queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
          return true
        })
      })
      const lines = script[children.length] ?? [READY]
      children.push(child)
      // Why a microtask: the manager attaches its listeners right after spawn returns.
      queueMicrotask(() => {
        for (const line of lines) {
          child.stdout.emit('data', Buffer.from(line))
        }
      })
      return child
    })
  } satisfies SshVpnDockerPort
  return { docker, children }
}

function createManager(
  docker: SshVpnDockerPort,
  overrides: Partial<ConstructorParameters<typeof SshVpnManager>[0]> = {}
) {
  const states: SshVpnProfileState[] = []
  const manager = new SshVpnManager({
    docker: async () => docker,
    instanceTag: 'tag12345',
    readFile: async () => Buffer.from('client\nremote vpn.example.com\n'),
    onStateChange: (state) => states.push(state),
    pollIntervalMs: 1_000,
    ...overrides
  })
  return { manager, states }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SshVpnManager', () => {
  it('starts one container for concurrent connections and returns its route', async () => {
    const { docker } = createFakeDocker()
    const { manager, states } = createManager(docker)

    const routes = await Promise.all([manager.acquire(PROFILE), manager.acquire(PROFILE)])

    expect(routes).toEqual([
      { dockerPath: '/usr/local/bin/docker', containerName: CONTAINER },
      { dockerPath: '/usr/local/bin/docker', containerName: CONTAINER }
    ])
    expect(docker.startContainer).toHaveBeenCalledTimes(1)
    expect(docker.spawnOpenVpn).toHaveBeenCalledTimes(1)
    expect(docker.writeFile).toHaveBeenCalledWith(
      CONTAINER,
      '/run/orca/profile.ovpn',
      Buffer.from('client\nremote vpn.example.com\n')
    )
    expect(states.map((state) => state.status)).toEqual(['starting', 'ready'])
    expect(manager.getReadyRoute(PROFILE.id)).toEqual(routes[0])
  })

  it('reports the OpenVPN cause, removes the container and stays retryable', async () => {
    const { docker } = createFakeDocker([
      [
        '2026-09-29 10:00:00 TLS Error: TLS handshake failed\n',
        '2026-09-29 10:00:00 Exiting due to fatal error\n'
      ],
      [READY]
    ])
    const { manager } = createManager(docker)

    await expect(manager.acquire(PROFILE)).rejects.toThrow(
      'VPN "Office": TLS Error: TLS handshake failed'
    )
    expect(docker.remove).toHaveBeenLastCalledWith(CONTAINER)
    expect(manager.getState(PROFILE.id)).toMatchObject({
      status: 'error',
      error: 'TLS Error: TLS handshake failed'
    })
    expect(manager.getReadyRoute(PROFILE.id)).toBeNull()

    await expect(manager.acquire(PROFILE)).resolves.toMatchObject({ containerName: CONTAINER })
  })

  it('refuses unsupported profiles before touching Docker', async () => {
    const { docker } = createFakeDocker()
    const { manager } = createManager(docker, {
      readFile: async () => Buffer.from('static-challenge "OTP" 1\n')
    })

    await expect(manager.acquire(PROFILE)).rejects.toThrow(/one-time codes/)
    expect(docker.startContainer).not.toHaveBeenCalled()
  })

  it('surfaces a missing Docker as the start error', async () => {
    const { manager } = createManager(createFakeDocker().docker, {
      docker: async () => {
        throw new Error('Docker was not found')
      }
    })

    await expect(manager.acquire(PROFILE)).rejects.toThrow('VPN "Office": Docker was not found')
  })

  it('times out when the tunnel never comes up', async () => {
    vi.useFakeTimers()
    const { docker } = createFakeDocker([['2026-09-29 10:00:00 Attempting to establish TCP\n']])
    const { manager } = createManager(docker, { readyTimeoutMs: 5_000 })

    const acquired = expect(manager.acquire(PROFILE)).rejects.toThrow(
      /Timed out waiting for the tunnel\. Last output: Attempting to establish TCP/
    )
    await vi.advanceTimersByTimeAsync(5_000)
    await acquired
  })

  it('marks the VPN down when OpenVPN exits and restarts it on the next connection', async () => {
    const { docker, children } = createFakeDocker()
    const { manager } = createManager(docker)
    await manager.acquire(PROFILE)

    children[0].stdout.emit('data', Buffer.from('2026-09-29 10:05:00 Connection reset\n'))
    children[0].emit('close', 1, null)
    await vi.waitFor(() => expect(manager.getState(PROFILE.id).status).toBe('error'))

    expect(manager.getState(PROFILE.id).error).toBe('OpenVPN stopped: Connection reset')
    expect(docker.remove).toHaveBeenLastCalledWith(CONTAINER)
    await manager.acquire(PROFILE)
    expect(docker.spawnOpenVpn).toHaveBeenCalledTimes(2)
  })

  it('stops after the idle window with no connections, not while one is open', async () => {
    vi.useFakeTimers()
    const { docker } = createFakeDocker()
    const { manager } = createManager(docker)
    await manager.acquire(PROFILE)
    docker.remove.mockClear()

    docker.countTunnels.mockResolvedValue(1)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(manager.getState(PROFILE.id).status).toBe('ready')

    docker.countTunnels.mockResolvedValue(0)
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(manager.getState(PROFILE.id).status).toBe('ready')
    await vi.advanceTimersByTimeAsync(2 * 60_000)

    expect(manager.getState(PROFILE.id).status).toBe('stopped')
    expect(docker.remove).toHaveBeenCalledWith(CONTAINER)
    expect(manager.getReadyRoute(PROFILE.id)).toBeNull()
  })

  it('never stops on idle when the profile says 0 minutes', async () => {
    vi.useFakeTimers()
    const { docker } = createFakeDocker()
    const { manager } = createManager(docker)
    await manager.acquire({ ...PROFILE, idleMinutes: 0 })

    await vi.advanceTimersByTimeAsync(60 * 60_000)

    expect(manager.getState(PROFILE.id).status).toBe('ready')
    expect(docker.countTunnels).not.toHaveBeenCalled()
  })

  it('stop removes the container and ignores the killed process exiting', async () => {
    const { docker } = createFakeDocker()
    const { manager, states } = createManager(docker)
    await manager.acquire(PROFILE)

    await manager.stop(PROFILE.id)
    await Promise.resolve()

    expect(docker.remove).toHaveBeenLastCalledWith(CONTAINER)
    expect(states.map((state) => state.status)).toEqual([
      'starting',
      'ready',
      'stopping',
      'stopped'
    ])
    expect(manager.runningContainers()).toEqual([])
  })

  it('shows every command before starting and builds the image only when missing', async () => {
    const { docker } = createFakeDocker()
    docker.hasImage.mockResolvedValue(false)
    const { manager } = createManager(docker)
    const confirm = vi.fn(async (_commands: string[]) => true)

    await manager.acquire(PROFILE, { confirm })

    const [commands] = confirm.mock.calls[0]
    expect(commands[0]).toBe('/usr/local/bin/docker info --format ' + "'{{.ServerVersion}}'")
    expect(commands.some((line) => line.includes(' build --tag '))).toBe(true)
    expect(commands.at(-1)).toContain(' openvpn --config /run/orca/profile.ovpn')
    expect(docker.buildImage).toHaveBeenCalledTimes(1)
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
      docker.buildImage.mock.invocationCallOrder[0]
    )
  })

  it('starts nothing when the user declines, and does not ask queued requests again', async () => {
    const { docker } = createFakeDocker()
    const { manager, states } = createManager(docker)
    let answer: (approved: boolean) => void = () => undefined
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        })
    )

    const first = manager.acquire(PROFILE, { confirm })
    const second = manager.acquire(PROFILE, { confirm })
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    answer(false)

    await expect(first).rejects.toThrow('VPN "Office" was not started')
    await expect(second).rejects.toThrow('VPN "Office" was not started')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(docker.startContainer).not.toHaveBeenCalled()
    expect(states.at(-1)?.status).toBe('stopped')

    confirm.mockResolvedValueOnce(true)
    await expect(manager.acquire(PROFILE, { confirm })).resolves.toMatchObject({
      containerName: CONTAINER
    })
  })

  it('does not ask again while the VPN is already up', async () => {
    const { docker } = createFakeDocker()
    const { manager } = createManager(docker)
    const confirm = vi.fn(async () => true)

    await manager.acquire(PROFILE, { confirm })
    await manager.acquire(PROFILE, { confirm })

    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('writes the login into the container and tells OpenVPN to read it', async () => {
    const { docker } = createFakeDocker()
    const { manager } = createManager(docker, {
      readFile: async () => Buffer.from('client\nauth-user-pass\n')
    })

    await manager.acquire(PROFILE, {
      credentials: async () => ({ username: 'omar', password: 'secret' })
    })

    expect(docker.writeFile).toHaveBeenCalledWith(
      CONTAINER,
      '/run/orca/login',
      Buffer.from('omar\nsecret\n')
    )
    expect(docker.spawnOpenVpn).toHaveBeenCalledWith(CONTAINER, true)
  })

  it('treats a cancelled login as not starting, and reports a rejected one', async () => {
    const { docker } = createFakeDocker([
      [
        '2026-09-29 10:00:00 AUTH: Received control message: AUTH_FAILED\n',
        '2026-09-29 10:00:00 Exiting due to fatal error\n'
      ]
    ])
    const { manager } = createManager(docker, {
      readFile: async () => Buffer.from('client\nauth-user-pass\n')
    })

    await expect(manager.acquire(PROFILE, { credentials: async () => null })).rejects.toThrow(
      'VPN "Office" was not started'
    )
    expect(docker.startContainer).not.toHaveBeenCalled()

    const onLoginRejected = vi.fn()
    await expect(
      manager.acquire(PROFILE, {
        credentials: async () => ({ username: 'omar', password: 'wrong' }),
        onLoginRejected
      })
    ).rejects.toThrow('VPN "Office": The VPN server rejected the login (AUTH_FAILED)')
    expect(onLoginRejected).toHaveBeenCalledTimes(1)
  })

  it('removes containers a previous run left behind', async () => {
    const { docker } = createFakeDocker()
    docker.listContainers.mockResolvedValue(['old-a', 'old-b'])
    const { manager } = createManager(docker)

    await manager.removeStaleContainers()

    expect(docker.listContainers).toHaveBeenCalledWith('tag12345')
    expect(docker.remove).toHaveBeenCalledWith('old-a')
    expect(docker.remove).toHaveBeenCalledWith('old-b')
  })
})

describe('SshVpnManager with a borrowed container', () => {
  const BORROWED: SshVpnProfile = {
    id: PROFILE.id,
    kind: 'container',
    name: 'Office (shared)',
    containerName: 'vpn-office-1'
  }
  const RULES = [
    '-P OUTPUT ACCEPT',
    '-A OUTPUT -o tun+ -m owner --uid-owner 100 -j ACCEPT',
    '-A OUTPUT -m owner --uid-owner 100 -j REJECT --reject-with icmp-port-unreachable'
  ].join('\n')

  function borrowableDocker() {
    const fake = createFakeDocker()
    fake.docker.query.mockImplementation(async (args: readonly string[]) => ({
      code: 0,
      signal: null,
      stdout:
        args[0] === 'container'
          ? JSON.stringify({ Running: true, Status: 'running', Health: { Status: 'healthy' } })
          : `100\n@@orca-section@@\n${RULES}\n@@orca-section@@\n${RULES}\n`,
      stderr: '',
      timedOut: false
    }))
    return fake
  }

  it('routes through the borrowed container and never starts, stops or removes one', async () => {
    const { docker } = borrowableDocker()
    const { manager } = createManager(docker)

    await expect(manager.acquire(BORROWED)).resolves.toEqual({
      dockerPath: '/usr/local/bin/docker',
      containerName: 'vpn-office-1'
    })
    expect(manager.runningContainers()).toEqual([])
    await manager.stop(BORROWED.id)

    expect(docker.startContainer).not.toHaveBeenCalled()
    expect(docker.spawnOpenVpn).not.toHaveBeenCalled()
    expect(docker.remove).not.toHaveBeenCalled()
    expect(manager.getState(BORROWED.id).status).toBe('stopped')
  })

  it("removes Orca's own container when a profile switches to a borrowed one", async () => {
    const { docker } = borrowableDocker()
    const { manager } = createManager(docker)
    await manager.acquire(PROFILE)

    await manager.acquire(BORROWED)

    expect(docker.remove).toHaveBeenLastCalledWith(CONTAINER)
    expect(manager.listStates()).toEqual([{ profileId: PROFILE.id, status: 'ready', logTail: [] }])
    expect(manager.getReadyRoute(PROFILE.id)?.containerName).toBe('vpn-office-1')
  })
})
