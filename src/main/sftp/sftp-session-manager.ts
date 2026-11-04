import type { SshCachedCredentials } from '../ssh/connection/ssh-connection'
import type { SshConnectionStatus, SshTarget } from '../../shared/ssh-types'
import type {
  SftpEntry,
  SftpExecuteOutcome,
  SftpExecuteRequest,
  SftpPlan,
  SftpPlanRequest,
  SftpTransferProgress
} from '../../shared/sftp-types'
import type { SpawnSftpLocalWriter } from './local-writer/sftp-local-writer'
import { runSftpOperations } from './sftp-operation-runner'
import { isSftpStatusError, sftpRealpath, type SftpOps } from './sftp-ops'
import { draftSftpPlan } from './sftp-plan-builders'
import { SftpPlanStore } from './sftp-plan-store'
import { listRemoteDirectory } from './sftp-remote-entries'

/** The slice of SshConnection the SFTP page needs; its own connection, never the relay's. */
export type SftpConnection = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  usesSystemSshTransport(): boolean
  sftp(): Promise<SftpOps>
  getReusableCredentials(): SshCachedCredentials | null
  getState(): { status: SshConnectionStatus }
}

type SftpSessionManagerDeps = {
  getTarget: (targetId: string) => SshTarget | undefined
  createConnection: (target: SshTarget, credentials?: SshCachedCredentials) => SftpConnection
  /** A remembered sign-in only applies to the endpoint it was given for. */
  signInEndpoint: (target: SshTarget) => string
  onProgress: (progress: SftpTransferProgress) => void
  idleMs?: number
  plans?: SftpPlanStore
  spawnLocalWriter?: SpawnSftpLocalWriter
}

type Session = {
  connection: SftpConnection
  signInEndpoint: string
  ready: Promise<void>
  /** True once `ready` resolved; before that the connection's state says nothing yet. */
  isReady: boolean
  browse: Promise<SftpOps> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  activeTransfers: number
  activeBrowseCalls: number
}

type TransferRecord = { cancelled: boolean; channel: SftpOps | null }

const DEFAULT_IDLE_MS = 5 * 60_000
/** A connection in one of these will not recover by itself, so the next request replaces it. */
const FINISHED_STATUSES: ReadonlySet<SshConnectionStatus> = new Set([
  'disconnected',
  'auth-failed',
  'reconnection-failed',
  'error'
])
const PROGRESS_INTERVAL_MS = 100
const PLAN_EXPIRED_MESSAGE = 'This confirmation expired or was already used. Try the action again.'
const SYSTEM_TRANSPORT_MESSAGE =
  'This host connects through the system ssh (ProxyJump, ProxyCommand or a hardware key), which SFTP does not support yet.'

function createProgressReporter(emit: (progress: SftpTransferProgress) => void): {
  report: (progress: SftpTransferProgress) => void
  flush: () => void
} {
  let lastEmitAt = 0
  let pending: SftpTransferProgress | null = null
  return {
    report: (progress) => {
      pending = progress
      const now = Date.now()
      if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
        emit(progress)
        lastEmitAt = now
        pending = null
      }
    },
    flush: () => {
      if (pending) {
        emit(pending)
        pending = null
      }
    }
  }
}

export class SftpSessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly transfers = new Map<string, TransferRecord>()
  /** Why: an idle disconnect is the app's choice, so reconnecting later must not ask the user again. */
  private readonly retainedSignIns = new Map<
    string,
    { endpoint: string; credentials: SshCachedCredentials }
  >()
  private readonly plans: SftpPlanStore

  constructor(private readonly deps: SftpSessionManagerDeps) {
    this.plans = deps.plans ?? new SftpPlanStore()
  }

  home(targetId: string): Promise<string> {
    return this.withBrowseChannel(targetId, (sftp) => sftpRealpath(sftp, '.'))
  }

  list(targetId: string, dir: string): Promise<SftpEntry[]> {
    return this.withBrowseChannel(targetId, (sftp) => listRemoteDirectory(sftp, dir))
  }

  /** Lists every step an action would run; nothing changes until `execute`. */
  async plan(request: SftpPlanRequest): Promise<SftpPlan> {
    const draft = await this.withBrowseChannel(request.targetId, (sftp) =>
      draftSftpPlan(sftp, request)
    )
    return this.plans.save({ ...draft, kind: request.kind, targetId: request.targetId })
  }

  discardPlan(planId: string): void {
    this.plans.discard(planId)
  }

  /** Runs the stored plan the user confirmed, exactly as it was shown. */
  async execute(request: SftpExecuteRequest): Promise<SftpExecuteOutcome> {
    const plan = this.plans.take(request.planId)
    if (!plan) {
      throw new Error(PLAN_EXPIRED_MESSAGE)
    }
    if (plan.kind === 'upload' || plan.kind === 'download') {
      return this.executeTransfer(plan, request.transferId)
    }
    await this.withBrowseChannel(plan.targetId, (sftp) =>
      runSftpOperations(sftp, plan.operations, () => undefined)
    )
    return { status: 'done' }
  }

  private async executeTransfer(plan: SftpPlan, transferId: string): Promise<SftpExecuteOutcome> {
    const session = await this.ensureSession(plan.targetId)
    const record: TransferRecord = { cancelled: false, channel: null }
    this.transfers.set(transferId, record)
    session.activeTransfers += 1
    this.clearIdleTimer(session)
    try {
      // Why: each transfer gets its own channel, so cancelling it never disturbs browsing.
      record.channel = await session.connection.sftp()
      if (record.cancelled) {
        return { status: 'cancelled' }
      }
      const reporter = createProgressReporter(this.deps.onProgress)
      await runSftpOperations(
        record.channel,
        plan.operations,
        (progress) => reporter.report({ transferId, totalBytes: plan.totalBytes, ...progress }),
        { localRoot: plan.localRoot, spawnLocalWriter: this.deps.spawnLocalWriter }
      )
      reporter.flush()
      return { status: 'done' }
    } catch (err) {
      if (record.cancelled) {
        return { status: 'cancelled' }
      }
      throw err
    } finally {
      record.channel?.end()
      this.transfers.delete(transferId)
      session.activeTransfers -= 1
      this.touch(plan.targetId)
    }
  }

  cancel(transferId: string): void {
    const record = this.transfers.get(transferId)
    if (record) {
      record.cancelled = true
      record.channel?.end()
    }
  }

  /** The user's own disconnect: unlike an idle one, the next connection asks for its sign-in. */
  async disconnect(targetId: string): Promise<void> {
    // Why here too: each window has its own transfer list, so its button may not know of this one.
    if (this.sessions.get(targetId)?.activeTransfers) {
      return
    }
    this.retainedSignIns.delete(targetId)
    await this.closeSession(targetId)
  }

  private async disconnectIdle(targetId: string): Promise<void> {
    const session = this.sessions.get(targetId)
    const credentials = session?.connection.getReusableCredentials()
    if (session && credentials) {
      this.retainedSignIns.set(targetId, { endpoint: session.signInEndpoint, credentials })
    }
    await this.closeSession(targetId)
  }

  private takeRetainedSignIn(target: SshTarget): SshCachedCredentials | undefined {
    const retained = this.retainedSignIns.get(target.id)
    this.retainedSignIns.delete(target.id)
    return retained?.endpoint === this.deps.signInEndpoint(target)
      ? retained.credentials
      : undefined
  }

  private async closeSession(targetId: string): Promise<void> {
    const session = this.sessions.get(targetId)
    if (!session) {
      return
    }
    this.sessions.delete(targetId)
    this.clearIdleTimer(session)
    await session.connection.disconnect().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    this.retainedSignIns.clear()
    await Promise.all([...this.sessions.keys()].map((targetId) => this.closeSession(targetId)))
  }

  private async ensureSession(targetId: string): Promise<Session> {
    const existing = this.sessions.get(targetId)
    if (existing?.isReady && FINISHED_STATUSES.has(existing.connection.getState().status)) {
      await this.disconnectIdle(targetId)
    }
    let session = this.sessions.get(targetId)
    if (!session) {
      const target = this.deps.getTarget(targetId)
      if (!target) {
        throw new Error('SSH host not found')
      }
      const connection = this.deps.createConnection(target, this.takeRetainedSignIn(target))
      const created: Session = {
        connection,
        signInEndpoint: this.deps.signInEndpoint(target),
        ready: connection.connect(),
        isReady: false,
        browse: null,
        idleTimer: null,
        activeTransfers: 0,
        activeBrowseCalls: 0
      }
      this.sessions.set(targetId, created)
      created.ready.then(
        () => {
          created.isReady = true
        },
        () => {
          if (this.sessions.get(targetId) === created) {
            this.sessions.delete(targetId)
          }
        }
      )
      session = created
    }
    await session.ready
    if (session.connection.usesSystemSshTransport()) {
      await this.closeSession(targetId)
      throw new Error(SYSTEM_TRANSPORT_MESSAGE)
    }
    return session
  }

  private async withBrowseChannel<T>(
    targetId: string,
    run: (sftp: SftpOps) => Promise<T>
  ): Promise<T> {
    const session = await this.ensureSession(targetId)
    session.browse ??= session.connection.sftp()
    const browse = session.browse
    // Why: a long delete runs through here too, and going idle must not cut it off midway.
    session.activeBrowseCalls += 1
    this.clearIdleTimer(session)
    try {
      return await run(await browse)
    } catch (err) {
      // Why: a per-request status (no such file…) leaves the channel usable; anything else may
      // mean it died, so open a fresh one next time.
      if (!isSftpStatusError(err) && session.browse === browse) {
        session.browse = null
      }
      throw err
    } finally {
      session.activeBrowseCalls -= 1
      this.touch(targetId)
    }
  }

  private touch(targetId: string): void {
    const session = this.sessions.get(targetId)
    if (!session) {
      return
    }
    this.clearIdleTimer(session)
    if (session.activeTransfers === 0 && session.activeBrowseCalls === 0) {
      session.idleTimer = setTimeout(
        () => void this.disconnectIdle(targetId),
        this.deps.idleMs ?? DEFAULT_IDLE_MS
      )
    }
  }

  private clearIdleTimer(session: Session): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }
}
