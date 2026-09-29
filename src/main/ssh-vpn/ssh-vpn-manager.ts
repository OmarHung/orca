import type { SshVpnProfile, SshVpnProfileState, SshVpnStatus } from '../../shared/ssh-vpn-types'
import { classifyOpenVpnLine, describeOpenVpnFailure, OpenVpnLogTail } from './openvpn-output'
import { CONTAINER_PROFILE_PATH, prepareOvpnProfile } from './ovpn-profile-preparation'
import { sshVpnContainerName, type SshVpnDocker } from './ssh-vpn-docker'

const DEFAULT_READY_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 60_000
const MS_PER_MINUTE = 60_000

/** The parts of the `docker exec … openvpn` child the manager uses. */
export type OpenVpnProcess = {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stdin: { end(): unknown }
  kill(): boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
}

export type SshVpnDockerPort = Pick<
  SshVpnDocker,
  | 'dockerPath'
  | 'assertRunning'
  | 'ensureImage'
  | 'startContainer'
  | 'writeFile'
  | 'countTunnels'
  | 'remove'
  | 'listContainers'
> & { spawnOpenVpn(containerName: string): OpenVpnProcess }

export type SshVpnManagerDeps = {
  /** Resolves the docker CLI; rejects with a user-facing message when it is missing. */
  docker: () => Promise<SshVpnDockerPort>
  /** Scopes containers to this Orca profile so a dev build never removes the installed app's. */
  instanceTag: string
  readFile: (filePath: string) => Promise<Buffer>
  onStateChange?: (state: SshVpnProfileState) => void
  now?: () => number
  readyTimeoutMs?: number
  pollIntervalMs?: number
}

/** How a connection reaches a ready VPN: pipe through `nc` in this container. */
export type SshVpnRoute = { dockerPath: string; containerName: string }

type Entry = {
  profile: SshVpnProfile
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
}

/** One OpenVPN container per profile: started on first use, stopped when idle, removed on quit. */
export class SshVpnManager {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number

  constructor(private readonly deps: SshVpnManagerDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Starts the profile's VPN if needed and returns the route once the tunnel is up. */
  acquire(profile: SshVpnProfile): Promise<SshVpnRoute> {
    const entry = this.entryFor(profile)
    entry.profile = profile
    return this.exclusive(entry, async () => {
      if (entry.status !== 'ready') {
        await this.start(entry)
      }
      // Why: gives the caller a full idle window to open its `nc` before the next poll counts.
      entry.idleSince = this.now()
      return this.routeOf(entry)
    })
  }

  /** The route when the VPN is up right now; never starts anything. */
  getReadyRoute(profileId: string): SshVpnRoute | null {
    const entry = this.entries.get(profileId)
    return entry?.status === 'ready' ? this.routeOf(entry) : null
  }

  stop(profileId: string): Promise<void> {
    const entry = this.entries.get(profileId)
    return entry ? this.exclusive(entry, () => this.teardown(entry, 'stopped')) : Promise.resolve()
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((profileId) => this.stop(profileId)))
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
    const entry = this.entries.get(profileId)
    return entry ? this.stateOf(entry) : { profileId, status: 'stopped', logTail: [] }
  }

  listStates(): SshVpnProfileState[] {
    return [...this.entries.values()].map((entry) => this.stateOf(entry))
  }

  private entryFor(profile: SshVpnProfile): Entry {
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
        pollTimer: null
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

  private async start(entry: Entry): Promise<void> {
    const generation = ++entry.generation
    entry.log = new OpenVpnLogTail()
    this.setStatus(entry, 'starting')
    let docker: SshVpnDockerPort | null = null
    try {
      docker = await this.deps.docker()
      entry.dockerPath = docker.dockerPath
      const prepared = await prepareOvpnProfile(entry.profile.ovpnPath, this.deps.readFile)
      await docker.assertRunning()
      await docker.ensureImage()
      await docker.remove(entry.containerName)
      await docker.startContainer(entry.containerName, this.deps.instanceTag, entry.profile.id)
      const files = [
        { containerPath: CONTAINER_PROFILE_PATH, content: Buffer.from(prepared.config) },
        ...prepared.files
      ]
      for (const file of files) {
        await docker.writeFile(entry.containerName, file.containerPath, file.content)
      }
      await this.runOpenVpn(entry, docker, generation)
    } catch (error) {
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

  private runOpenVpn(entry: Entry, docker: SshVpnDockerPort, generation: number): Promise<void> {
    const child = docker.spawnOpenVpn(entry.containerName)
    entry.openvpn = child
    child.stdin.end()
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (error?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      const timer = setTimeout(
        () =>
          settle(
            new Error(
              `Timed out waiting for the tunnel. Last output: ${describeOpenVpnFailure(entry.log.snapshot())}`
            )
          ),
        this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
      )
      const onOutput = (chunk: Buffer | string): void => {
        for (const line of entry.log.push(chunk.toString())) {
          const event = classifyOpenVpnLine(line)
          if (event.kind === 'ready') {
            settle()
          } else if (event.kind === 'failed') {
            settle(new Error(describeOpenVpnFailure(entry.log.snapshot())))
          }
        }
      }
      child.stdout.on('data', onOutput)
      child.stderr.on('data', onOutput)
      child.on('error', (error) => settle(error))
      child.on('close', () => {
        if (!settled) {
          settle(new Error(describeOpenVpnFailure(entry.log.snapshot())))
          return
        }
        this.onTunnelExited(entry, generation)
      })
    })
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
