import type { SshTarget } from '../../shared/ssh-types'
import type {
  SftpEntry,
  SftpExecuteOutcome,
  SftpExecuteRequest,
  SftpPlan,
  SftpPlanRequest,
  SftpTransferProgress
} from '../../shared/sftp-types'
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
}

type SftpSessionManagerDeps = {
  getTarget: (targetId: string) => SshTarget | undefined
  createConnection: (target: SshTarget) => SftpConnection
  onProgress: (progress: SftpTransferProgress) => void
  idleMs?: number
  plans?: SftpPlanStore
}

type Session = {
  connection: SftpConnection
  ready: Promise<void>
  browse: Promise<SftpOps> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  activeTransfers: number
}

type TransferRecord = { cancelled: boolean; channel: SftpOps | null }

const DEFAULT_IDLE_MS = 5 * 60_000
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
      await runSftpOperations(record.channel, plan.operations, (progress) =>
        reporter.report({ transferId, totalBytes: plan.totalBytes, ...progress })
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

  async disconnect(targetId: string): Promise<void> {
    const session = this.sessions.get(targetId)
    if (!session) {
      return
    }
    this.sessions.delete(targetId)
    this.clearIdleTimer(session)
    await session.connection.disconnect().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((targetId) => this.disconnect(targetId)))
  }

  private async ensureSession(targetId: string): Promise<Session> {
    let session = this.sessions.get(targetId)
    if (!session) {
      const target = this.deps.getTarget(targetId)
      if (!target) {
        throw new Error('SSH host not found')
      }
      const connection = this.deps.createConnection(target)
      const created: Session = {
        connection,
        ready: connection.connect(),
        browse: null,
        idleTimer: null,
        activeTransfers: 0
      }
      this.sessions.set(targetId, created)
      created.ready.catch(() => {
        if (this.sessions.get(targetId) === created) {
          this.sessions.delete(targetId)
        }
      })
      session = created
    }
    await session.ready
    if (session.connection.usesSystemSshTransport()) {
      await this.disconnect(targetId)
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
      this.touch(targetId)
    }
  }

  private touch(targetId: string): void {
    const session = this.sessions.get(targetId)
    if (!session) {
      return
    }
    this.clearIdleTimer(session)
    if (session.activeTransfers === 0) {
      session.idleTimer = setTimeout(
        () => void this.disconnect(targetId),
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
