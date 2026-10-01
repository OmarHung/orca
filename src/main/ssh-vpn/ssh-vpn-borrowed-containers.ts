import type {
  SshVpnContainerProfile,
  SshVpnProfileState,
  SshVpnStatus
} from '../../shared/ssh-vpn-types'
import { checkBorrowedContainer, type BorrowedContainerDocker } from './borrowed-container-check'
import type { SshVpnRoute } from './ssh-vpn-manager-types'

const DEFAULT_RECHECK_INTERVAL_MS = 60_000

type BorrowedEntry = {
  profile: SshVpnContainerProfile
  status: SshVpnStatus
  error?: string
  dockerPath: string | null
  /** Bumped by every release and failure so a check that was in flight cannot mark it ready. */
  generation: number
  queue: Promise<unknown>
  recheckTimer: ReturnType<typeof setInterval> | null
}

type BorrowedContainersDeps = {
  docker: () => Promise<BorrowedContainerDocker>
  onStateChange?: (state: SshVpnProfileState) => void
  recheckIntervalMs?: number
}

/**
 * VPN containers someone else runs (e.g. openvpn-socks). Orca never starts, stops or removes
 * them: "ready" only means the last check found the container up and failing closed. Every
 * acquire checks again, so a container recreated without its firewall is refused at once.
 */
export class SshVpnBorrowedContainers {
  private readonly entries = new Map<string, BorrowedEntry>()

  constructor(private readonly deps: BorrowedContainersDeps) {}

  acquire(profile: SshVpnContainerProfile): Promise<SshVpnRoute> {
    const entry = this.entryFor(profile)
    if (entry.profile.containerName !== profile.containerName) {
      this.release(profile.id)
    }
    entry.profile = profile
    return this.exclusive(entry, () => this.check(entry))
  }

  updateProfile(profile: SshVpnContainerProfile): void {
    const entry = this.entries.get(profile.id)
    if (entry?.profile.containerName === profile.containerName) {
      entry.profile = profile
    }
  }

  getReadyRoute(profileId: string): SshVpnRoute | null {
    const entry = this.entries.get(profileId)
    return entry?.status === 'ready' && entry.dockerPath
      ? { dockerPath: entry.dockerPath, containerName: entry.profile.containerName }
      : null
  }

  /** Stops routing through the container; the container itself keeps running. */
  release(profileId: string): void {
    const entry = this.entries.get(profileId)
    if (entry && entry.status !== 'stopped') {
      this.settle(entry, 'stopped')
    }
  }

  releaseAll(): void {
    for (const profileId of this.entries.keys()) {
      this.release(profileId)
    }
  }

  listStates(): SshVpnProfileState[] {
    return [...this.entries.values()].map((entry) => this.stateOf(entry))
  }

  private entryFor(profile: SshVpnContainerProfile): BorrowedEntry {
    let entry = this.entries.get(profile.id)
    if (!entry) {
      entry = {
        profile,
        status: 'stopped',
        dockerPath: null,
        generation: 0,
        queue: Promise.resolve(),
        recheckTimer: null
      }
      this.entries.set(profile.id, entry)
    }
    return entry
  }

  private exclusive<T>(entry: BorrowedEntry, run: () => Promise<T>): Promise<T> {
    const result = entry.queue.then(run, run)
    entry.queue = result.catch(() => undefined)
    return result
  }

  private stateOf(entry: BorrowedEntry): SshVpnProfileState {
    return {
      profileId: entry.profile.id,
      status: entry.status,
      ...(entry.error ? { error: entry.error } : {}),
      logTail: []
    }
  }

  private setStatus(entry: BorrowedEntry, status: SshVpnStatus, error?: string): void {
    entry.status = status
    entry.error = error
    this.deps.onStateChange?.(this.stateOf(entry))
  }

  /** Leaves the ready state for good: no more rechecks, and in-flight checks are ignored. */
  private settle(entry: BorrowedEntry, status: 'stopped' | 'error', error?: string): void {
    entry.generation++
    if (entry.recheckTimer) {
      clearInterval(entry.recheckTimer)
      entry.recheckTimer = null
    }
    this.setStatus(entry, status, error)
  }

  private async check(entry: BorrowedEntry): Promise<SshVpnRoute> {
    const { profile } = entry
    // Why no status change when ready: database tunnels close as soon as it leaves `ready`.
    const wasReady = entry.status === 'ready'
    if (!wasReady) {
      entry.generation++
      this.setStatus(entry, 'starting')
    }
    const generation = entry.generation
    let dockerPath: string
    try {
      const docker = await this.deps.docker()
      dockerPath = docker.dockerPath
      entry.dockerPath = dockerPath
      await checkBorrowedContainer(docker, profile.containerName, { requireHealthy: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (entry.generation === generation) {
        this.settle(entry, 'error', message)
      }
      throw new Error(`VPN "${profile.name}": ${message}`)
    }
    if (entry.generation !== generation) {
      throw new Error(`VPN "${profile.name}" was disconnected`)
    }
    if (!wasReady) {
      this.setStatus(entry, 'ready')
      this.startRechecks(entry, generation)
    }
    return { dockerPath, containerName: profile.containerName }
  }

  /** Notices a container that stopped or lost its VPN even when nothing connects through it. */
  private startRechecks(entry: BorrowedEntry, generation: number): void {
    entry.recheckTimer = setInterval(() => {
      void this.exclusive(entry, async () => {
        if (entry.generation === generation && entry.status === 'ready') {
          await this.check(entry).catch(() => undefined)
        }
      })
    }, this.deps.recheckIntervalMs ?? DEFAULT_RECHECK_INTERVAL_MS)
    entry.recheckTimer.unref?.()
  }
}
