import type {
  DatabaseDumpProgress,
  DatabaseDumpSummary
} from '../../../../../shared/database/database-dump-types'
import { spawnProcess } from '../../../../../shared/child-process/run-process'
import { safeFileName, type DumpOutput } from '../dump-output'
import { DumpCancelled } from '../dump-writer'
import type { NativeDumpPlan } from './native-dump-plan'

const PROGRESS_INTERVAL_MS = 250
const STDERR_LIMIT = 16 * 1024
const MAX_WARNINGS = 5
const ERROR_LINES = 8
// How long a stopped tool gets to close, first after SIGTERM and again after SIGKILL.
const STOP_GRACE_MS = 5_000

type Spawn = typeof spawnProcess
type Exit = { code: number | null; signal: NodeJS.Signals | null; error: Error | null }
type Attempt = { ok: boolean; exit: Exit; stderr: string; wroteNothing: boolean }

export type NativeDumpRun = {
  plan: NativeDumpPlan
  output: DumpOutput
  tableCount: number
  onProgress: (progress: DatabaseDumpProgress) => void
  isCancelled: () => boolean
  spawn?: Spawn
}

/** Whether `closed` settles within `ms`. */
async function closesWithin(closed: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([closed.then(() => true), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

function stderrLines(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Runs a native tool's plan into the dump's files: its output goes straight through, paced by
 * the disk, and a cancel or failure removes what was written.
 */
export class NativeDumpRunner {
  private child: ReturnType<Spawn> | null = null
  private withoutTls = false
  private lastReport = 0
  private readonly progress: DatabaseDumpProgress

  constructor(private readonly run: NativeDumpRun) {
    this.progress = {
      tablesDone: 0,
      tableCount: run.tableCount,
      currentTable: null,
      rows: null,
      bytes: 0
    }
  }

  /** Stops the tool in flight; the dump then ends as cancelled. */
  cancel(): void {
    this.child?.kill()
  }

  async execute(): Promise<DatabaseDumpSummary> {
    const startedAt = Date.now()
    const { plan, output } = this.run
    const width = Math.max(3, String(plan.runs.length).length)
    const warnings: string[] = []
    try {
      for (const [index, step] of plan.runs.entries()) {
        this.checkCancelled()
        await output.startFile(
          `${String(index).padStart(width, '0')}_${safeFileName(step.label)}.sql`
        )
        this.progress.currentTable = step.label
        this.report(true)
        if (step.prelude) {
          await output.raw(step.prelude)
        }
        warnings.push(...(await this.runStep(step.args)))
        this.progress.tablesDone += step.tables
      }
      const files = await output.finish()
      this.report(true)
      return {
        cancelled: false,
        files,
        tables: this.run.tableCount,
        rows: null,
        bytes: output.bytes,
        durationMs: Date.now() - startedAt,
        notes: [...plan.notes, ...warnings.slice(0, MAX_WARNINGS)]
      }
    } catch (error) {
      await output.discard()
      if (!(error instanceof DumpCancelled) && !this.run.isCancelled()) {
        throw error
      }
      return {
        cancelled: true,
        files: [],
        tables: 0,
        rows: null,
        bytes: 0,
        durationMs: Date.now() - startedAt,
        notes: []
      }
    } finally {
      await plan.cleanup().catch(() => undefined)
    }
  }

  /** One run, retried without TLS when the plan allows it and TLS failed before any output. */
  private async runStep(args: string[]): Promise<string[]> {
    const { plan } = this.run
    const retry = plan.withoutTls
    const attempt = await this.spawnOnce(this.withoutTls && retry ? retry(args) : args)
    if (attempt.ok) {
      return this.warnings(attempt.stderr)
    }
    if (retry && !this.withoutTls && attempt.wroteNothing && /ssl|tls/i.test(attempt.stderr)) {
      this.withoutTls = true
      const second = await this.spawnOnce(retry(args))
      if (second.ok) {
        return this.warnings(second.stderr)
      }
      throw this.failure(second)
    }
    throw this.failure(attempt)
  }

  private async spawnOnce(args: string[]): Promise<Attempt> {
    const { plan, output } = this.run
    const before = output.bytes
    const child = (this.run.spawn ?? spawnProcess)({
      program: plan.tool.path,
      args,
      env: plan.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT)
    })
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    const exited = new Promise<Exit>((resolve) => {
      // Why `on`: a failed kill emits 'error' too, and an unheard one would crash the worker.
      child.on('error', (error) => resolve({ code: null, signal: null, error }))
      child.once('close', (code, signal) => resolve({ code, signal, error: null }))
    })
    try {
      for await (const chunk of child.stdout) {
        await output.raw(chunk)
        this.report(false)
        this.checkCancelled()
      }
      const exit = await exited
      this.checkCancelled()
      return {
        ok: exit.error === null && exit.code === 0,
        exit,
        stderr,
        wroteNothing: output.bytes === before
      }
    } finally {
      this.child = null
      await this.stop(child, closed)
    }
  }

  /** Stops a tool still running, and waits for it to let go of the files cleanup removes. */
  private async stop(child: ReturnType<Spawn>, closed: Promise<void>): Promise<void> {
    if (child.pid === undefined) {
      return
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
    if (await closesWithin(closed, STOP_GRACE_MS)) {
      return
    }
    child.kill('SIGKILL')
    // Why destroy: a grandchild still holding the pipes would keep 'close' from ever firing.
    child.stdout.destroy()
    child.stderr.destroy()
    if (!(await closesWithin(closed, STOP_GRACE_MS))) {
      console.warn(`[database] ${this.run.plan.tool.kind} did not exit after SIGKILL`)
    }
  }

  private warnings(stderr: string): string[] {
    return stderrLines(stderr).map((line) => `${this.run.plan.tool.kind}: ${line}`)
  }

  private failure(attempt: Attempt): Error {
    const { kind } = this.run.plan.tool
    const detail =
      attempt.exit.error?.message ??
      (stderrLines(attempt.stderr).slice(-ERROR_LINES).join('\n') ||
        `it exited with ${attempt.exit.code === null ? `signal ${attempt.exit.signal}` : `code ${attempt.exit.code}`}`)
    return new Error(`${kind} failed: ${detail}`)
  }

  private checkCancelled(): void {
    if (this.run.isCancelled()) {
      throw new DumpCancelled()
    }
  }

  private report(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastReport < PROGRESS_INTERVAL_MS) {
      return
    }
    this.lastReport = now
    this.run.onProgress({ ...this.progress, bytes: this.run.output.bytes })
  }
}
