import type {
  SshVpnOvpnProfile,
  SshVpnProfile,
  SshVpnProfileState,
  SshVpnStatus
} from '../../shared/ssh-vpn-types'
import { describeOpenVpnFailure, OpenVpnLogTail } from './openvpn-output'
import { waitForOpenVpnReady } from './openvpn-startup'
import { SshVpnBorrowedContainers } from './ssh-vpn-borrowed-containers'
import { sshVpnContainerName } from './ssh-vpn-docker'
import {
  SshVpnStartDeclinedError,
  type OpenVpnProcess,
  type SshVpnDockerPort,
  type SshVpnManagerDeps,
  type SshVpnRoute,
  type SshVpnStartOptions
} from './ssh-vpn-manager-types'
import { prepareSshVpnContainer } from './ssh-vpn-start-sequence'

const DEFAULT_READY_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 60_000
const MS_PER_MINUTE = 60_000

type Entry = {
  profile: SshVpnOvpnProfile
  containerName: string
  status: SshVpnStatus
  error?: string
  log: OpenVpnLogTail
  openvpn: OpenVpnProcess | null
  dockerPath: string | null
  /** Bumped per start so a previous run's late exit event cannot touch the current one. */
  generation: number
  /** Serializes start/stop so an idle stop cannot interleave with a start. */
  queue: Promise<unknown>
  idleSince: number | null
  pollTimer: ReturnType<typeof setInterval> | null
  /** Counts the user saying no to a start; requests queued before a no are not asked again. */
  declines: number
}

/**
 * One OpenVPN container per .ovpn profile: started on first use, stopped when idle, removed on
 * quit. Profiles that borrow someone else's container are handed to SshVpnBorrowedContainers.
 */
export class SshVpnManager {
  private readonly entries = new Map<string, Entry>()
  private readonly borrowed: SshVpnBorrowedContainers
  private readonly now: () => number

  constructor(private readonly deps: SshVpnManagerDeps) {
    this.now = deps.now ?? Date.now
    this.borrowed = new SshVpnBorrowedContainers({
      docker: deps.docker,
      onStateChange: deps.onStateChange,
      recheckIntervalMs: deps.pollIntervalMs
    })
  }

  /**
   * Starts the profile's VPN if needed and returns the route once the tunnel is up. With
   * `confirm`, a start first shows the user its commands and does nothing unless they agree.
   */
  acquire(profile: SshVpnProfile, options?: SshVpnStartOptions): Promise<SshVpnRoute> {
    // Why stop the other kind first: a profile switched by hand-editing ssh-vpn.json keeps its id.
    if (profile.kind === 'container') {
      return this.stopOvpn(profile.id).then(() => this.borrowed.acquire(profile))
    }
    this.borrowed.release(profile.id)
    const entry = this.entryFor(profile)
    entry.profile = profile
    const declinesBefore = entry.declines
    return this.exclusive(entry, async () => {
      if (entry.status !== 'ready') {
        // Why: requests queued behind a start the user just declined share that answer.
        if (options?.confirm && entry.declines !== declinesBefore) {
          throw new SshVpnStartDeclinedError(`VPN "${profile.name}" was not started`)
        }
        await this.start(entry, options ?? {})
      }
      // Why: gives the caller a full idle window to open its `nc` before the next poll counts.
      entry.idleSince = this.now()
      return this.routeOf(entry)
    })
  }

  /** Picks up an edited profile (e.g. its idle window) without restarting the VPN. */
  updateProfile(profile: SshVpnProfile): void {
    if (profile.kind === 'container') {
      this.borrowed.updateProfile(profile)
      return
    }
    const entry = this.entries.get(profile.id)
    if (entry) {
      entry.profile = profile
    }
  }

  /** The route when the VPN is up right now; never starts anything. */
  getReadyRoute(profileId: string): SshVpnRoute | null {
    const entry = this.entries.get(profileId)
    return (
      this.borrowed.getReadyRoute(profileId) ??
      (entry?.status === 'ready' ? this.routeOf(entry) : null)
    )
  }

  stop(profileId: string): Promise<void> {
    this.borrowed.release(profileId)
    return this.stopOvpn(profileId)
  }

  async stopAll(): Promise<void> {
    this.borrowed.releaseAll()
    await Promise.all([...this.entries.keys()].map((profileId) => this.stopOvpn(profileId)))
  }

  /** Removes containers a previous run of this Orca left behind (crash, force quit). */
  async removeStaleContainers(): Promise<void> {
    const docker = await this.deps.docker()
    const names = await docker.listContainers(this.deps.instanceTag)
    await Promise.all(names.map((name) => docker.remove(name)))
  }

  /** Containers that may exist right now, for the synchronous removal at quit. */
  runningContainers(): SshVpnRoute[] {
    return [...this.entries.values()].flatMap((entry) =>
      entry.status !== 'stopped' && entry.dockerPath
        ? [{ dockerPath: entry.dockerPath, containerName: entry.containerName }]
        : []
    )
  }

  getState(profileId: string): SshVpnProfileState {
    return (
      this.listStates().find((state) => state.profileId === profileId) ?? {
        profileId,
        status: 'stopped',
        logTail: []
      }
    )
  }

  /** One state per profile; after a kind switch the side that is not stopped wins. */
  listStates(): SshVpnProfileState[] {
    const states = new Map<string, SshVpnProfileState>()
    for (const state of [
      ...[...this.entries.values()].map((entry) => this.stateOf(entry)),
      ...this.borrowed.listStates()
    ]) {
      if (states.get(state.profileId)?.status !== undefined && state.status === 'stopped') {
        continue
      }
      states.set(state.profileId, state)
    }
    return [...states.values()]
  }

  private stopOvpn(profileId: string): Promise<void> {
    const entry = this.entries.get(profileId)
    return entry ? this.exclusive(entry, () => this.teardown(entry, 'stopped')) : Promise.resolve()
  }

  private entryFor(profile: SshVpnOvpnProfile): Entry {
    let entry = this.entries.get(profile.id)
    if (!entry) {
      entry = {
        profile,
        containerName: sshVpnContainerName(this.deps.instanceTag, profile.id),
        status: 'stopped',
        log: new OpenVpnLogTail(),
        openvpn: null,
        dockerPath: null,
        generation: 0,
        queue: Promise.resolve(),
        idleSince: null,
        pollTimer: null,
        declines: 0
      }
      this.entries.set(profile.id, entry)
    }
    return entry
  }

  private exclusive<T>(entry: Entry, run: () => Promise<T>): Promise<T> {
    const result = entry.queue.then(run, run)
    entry.queue = result.catch(() => undefined)
    return result
  }

  private routeOf(entry: Entry): SshVpnRoute {
    if (!entry.dockerPath) {
      throw new Error('VPN route requested before the container started')
    }
    return { dockerPath: entry.dockerPath, containerName: entry.containerName }
  }

  private stateOf(entry: Entry): SshVpnProfileState {
    return {
      profileId: entry.profile.id,
      status: entry.status,
      ...(entry.error ? { error: entry.error } : {}),
      logTail: entry.log.snapshot()
    }
  }

  private setStatus(entry: Entry, status: SshVpnStatus, error?: string): void {
    entry.status = status
    entry.error = error
    this.deps.onStateChange?.(this.stateOf(entry))
  }

  private async start(entry: Entry, options: SshVpnStartOptions): Promise<void> {
    const generation = ++entry.generation
    entry.log = new OpenVpnLogTail()
    this.setStatus(entry, 'starting')
    let docker: SshVpnDockerPort | null = null
    let usesLogin = false
    try {
      docker = await this.deps.docker()
      entry.dockerPath = docker.dockerPath
      const prepared = await prepareSshVpnContainer({
        docker,
        profile: entry.profile,
        containerName: entry.containerName,
        instanceTag: this.deps.instanceTag,
        readFile: this.deps.readFile,
        options,
        onDeclined: () => {
          entry.declines += 1
        }
      })
      usesLogin = prepared.usesLogin
      // Why spawn here: output listeners must attach in the same tick as the spawn.
      const child = docker.spawnOpenVpn(entry.containerName, usesLogin)
      entry.openvpn = child
      await waitForOpenVpnReady(
        child,
        entry.log,
        this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        () => this.onTunnelExited(entry, generation)
      )
    } catch (error) {
      if (error instanceof SshVpnStartDeclinedError) {
        this.setStatus(entry, 'stopped')
        throw error
      }
      if (usesLogin && entry.log.snapshot().some((line) => line.includes('AUTH_FAILED'))) {
        options.onLoginRejected?.()
      }
      const message = error instanceof Error ? error.message : String(error)
      entry.openvpn?.kill()
      entry.openvpn = null
      await docker?.remove(entry.containerName).catch(() => undefined)
      this.setStatus(entry, 'error', message)
      throw new Error(`VPN "${entry.profile.name}": ${message}`)
    }
    this.setStatus(entry, 'ready')
    this.startIdlePolling(entry, generation)
  }

  /** OpenVPN died after the tunnel was up; every connection through it is already gone. */
  private onTunnelExited(entry: Entry, generation: number): void {
    if (entry.generation !== generation || entry.status !== 'ready') {
      return
    }
    void this.exclusive(entry, async () => {
      if (entry.generation !== generation || entry.status !== 'ready') {
        return
      }
      await this.teardown(
        entry,
        'error',
        `OpenVPN stopped: ${describeOpenVpnFailure(entry.log.snapshot())}`
      )
    })
  }

  private startIdlePolling(entry: Entry, generation: number): void {
    this.stopIdlePolling(entry)
    entry.pollTimer = setInterval(
      () => void this.pollIdle(entry, generation),
      this.deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    )
    entry.pollTimer.unref?.()
  }

  private stopIdlePolling(entry: Entry): void {
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer)
      entry.pollTimer = null
    }
  }

  private async pollIdle(entry: Entry, generation: number): Promise<void> {
    const idleMinutes = entry.profile.idleMinutes
    if (entry.generation !== generation || entry.status !== 'ready' || idleMinutes === 0) {
      return
    }
    let tunnels: number
    try {
      tunnels = await (await this.deps.docker()).countTunnels(entry.containerName)
    } catch {
      // Why: a vanished container also ends OpenVPN, and that exit handler owns the teardown.
      return
    }
    if (tunnels > 0) {
      entry.idleSince = null
      return
    }
    entry.idleSince ??= this.now()
    if (this.now() - entry.idleSince < idleMinutes * MS_PER_MINUTE) {
      return
    }
    await this.exclusive(entry, async () => {
      // Why re-check: an acquire queued ahead of this stop resets idleSince.
      if (
        entry.generation === generation &&
        entry.status === 'ready' &&
        entry.idleSince !== null &&
        this.now() - entry.idleSince >= idleMinutes * MS_PER_MINUTE
      ) {
        await this.teardown(entry, 'stopped')
      }
    })
  }

  private async teardown(entry: Entry, status: 'stopped' | 'error', error?: string): Promise<void> {
    if (entry.status === 'stopped') {
      return
    }
    entry.generation++
    this.stopIdlePolling(entry)
    this.setStatus(entry, 'stopping')
    entry.openvpn?.kill()
    entry.openvpn = null
    try {
      await (await this.deps.docker()).remove(entry.containerName)
    } finally {
      entry.idleSince = null
      this.setStatus(entry, status, error)
    }
  }
}
