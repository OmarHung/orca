import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '../../shared/child-process/process-spec'
import type { SshVpnContainerProfile, SshVpnProfileState } from '../../shared/ssh-vpn-types'
import { SshVpnBorrowedContainers } from './ssh-vpn-borrowed-containers'

const PROFILE: SshVpnContainerProfile = {
  id: 'profile-0002',
  kind: 'container',
  name: 'Office (shared)',
  containerName: 'vpn-office-1'
}

const SECTION = '@@orca-section@@'
const RULES = [
  '-P OUTPUT ACCEPT',
  '-A OUTPUT -o tun+ -m owner --uid-owner 100 -j ACCEPT',
  '-A OUTPUT -m owner --uid-owner 100 -j REJECT --reject-with icmp-port-unreachable'
].join('\n')

function result(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, signal: null, stdout, stderr, timedOut: false }
}

const HEALTHY = result(
  0,
  JSON.stringify({ Running: true, Status: 'running', Health: { Status: 'healthy' } })
)
const STOPPED = result(0, JSON.stringify({ Running: false, Status: 'exited' }))
const FIREWALL = result(0, `100\n${SECTION}\n${RULES}\n${SECTION}\n${RULES}\n`)

function createBorrowed(recheckIntervalMs = 60_000) {
  let inspect = HEALTHY
  const query = vi.fn(async (args: readonly string[]) =>
    args[0] === 'container' ? inspect : FIREWALL
  )
  const states: SshVpnProfileState[] = []
  const borrowed = new SshVpnBorrowedContainers({
    docker: async () => ({ dockerPath: '/usr/local/bin/docker', query }),
    onStateChange: (state) => states.push(state),
    recheckIntervalMs
  })
  return {
    borrowed,
    query,
    states,
    setInspect: (next: ProcessResult) => {
      inspect = next
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SshVpnBorrowedContainers', () => {
  it('routes through the borrowed container once its check passes', async () => {
    const { borrowed, states } = createBorrowed()

    await expect(borrowed.acquire(PROFILE)).resolves.toEqual({
      dockerPath: '/usr/local/bin/docker',
      containerName: 'vpn-office-1'
    })

    expect(states.map((state) => state.status)).toEqual(['starting', 'ready'])
    expect(borrowed.getReadyRoute(PROFILE.id)?.containerName).toBe('vpn-office-1')
  })

  it('checks again on every acquire without leaving ready, so database tunnels stay open', async () => {
    const { borrowed, query, states } = createBorrowed()
    await borrowed.acquire(PROFILE)
    query.mockClear()

    await borrowed.acquire(PROFILE)

    expect(query).toHaveBeenCalledTimes(2)
    expect(states.map((state) => state.status)).toEqual(['starting', 'ready'])
  })

  it('fails closed when the container stops while ready', async () => {
    const { borrowed, states, setInspect } = createBorrowed()
    await borrowed.acquire(PROFILE)
    setInspect(STOPPED)

    await expect(borrowed.acquire(PROFILE)).rejects.toThrow('Container "vpn-office-1" is exited')

    expect(states.at(-1)).toMatchObject({ status: 'error' })
    expect(borrowed.getReadyRoute(PROFILE.id)).toBeNull()
  })

  it('notices a stopped container on its own recheck', async () => {
    vi.useFakeTimers()
    const { borrowed, states, setInspect } = createBorrowed(1_000)
    await borrowed.acquire(PROFILE)
    setInspect(STOPPED)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(states.at(-1)).toMatchObject({ status: 'error' })
  })

  it('only forgets the route on release; it never runs a docker command to stop anything', async () => {
    const { borrowed, query, states } = createBorrowed()
    await borrowed.acquire(PROFILE)
    query.mockClear()

    borrowed.release(PROFILE.id)

    expect(query).not.toHaveBeenCalled()
    expect(states.at(-1)).toMatchObject({ status: 'stopped' })
    expect(borrowed.getReadyRoute(PROFILE.id)).toBeNull()
  })

  it('does not mark ready a check that a release overtook', async () => {
    const { borrowed, query } = createBorrowed()
    let unblock: () => void = () => undefined
    query.mockImplementationOnce(
      () =>
        new Promise<ProcessResult>((resolve) => {
          unblock = () => resolve(HEALTHY)
        })
    )
    const acquired = borrowed.acquire(PROFILE)
    await vi.waitFor(() => expect(query).toHaveBeenCalled())

    borrowed.release(PROFILE.id)
    unblock()

    await expect(acquired).rejects.toThrow('was disconnected')
    expect(borrowed.getReadyRoute(PROFILE.id)).toBeNull()
  })
})
