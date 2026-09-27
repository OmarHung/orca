import type { DatabaseDriver } from '../../../shared/database/database-connection-types'
import type { DatabaseScriptSummary } from '../../../shared/database/database-script-types'
import type { DatabaseDriverSession } from './database-driver'
import { toDatabaseError } from './database-error-mapping'
import type { DatabaseWorkerCommandOf, DatabaseWorkerMessage } from './database-worker-protocol'
import { runSqlScript } from './sql-script-runner'

type RunningJob = { consoleId: string; cancelled: boolean }

/** Long-running work (scripts) on server sessions of its own, so consoles stay usable. */
export class DatabaseWorkerJobs {
  private readonly running = new Map<string, RunningJob>()

  constructor(private readonly post: (message: DatabaseWorkerMessage) => void) {}

  async runScript(
    session: DatabaseDriverSession,
    driver: DatabaseDriver,
    { jobId, files, options }: DatabaseWorkerCommandOf<'runScript'>
  ): Promise<DatabaseScriptSummary> {
    if (this.running.has(jobId)) {
      throw new Error('This job is already running.')
    }
    const job: RunningJob = { consoleId: `job-${jobId}`, cancelled: false }
    this.running.set(jobId, job)
    try {
      return await runSqlScript({
        files,
        dialect: driver,
        options,
        runStatement: async (sql) => {
          const result = await session.execute(job.consoleId, sql, 1, {
            mode: options.transaction ? 'manual' : 'auto',
            database: options.database,
            schema: options.schema
          })
          return result.transaction
        },
        describeError: (error) => {
          const described = toDatabaseError(error)
          return { message: described.message, cancelled: described.code === 'cancelled' }
        },
        onProgress: (progress) =>
          this.post({ kind: 'job-progress', jobId, progress: { kind: 'script', ...progress } }),
        isCancelled: () => job.cancelled
      })
    } finally {
      this.running.delete(jobId)
      await session.closeConsole(job.consoleId).catch(() => undefined)
    }
  }

  /** Stops the job after its current statement, asking the server to cut that one short. */
  async cancel(session: DatabaseDriverSession | null, jobId: string): Promise<boolean> {
    const job = this.running.get(jobId)
    if (!job) {
      return false
    }
    job.cancelled = true
    await session?.cancel(job.consoleId).catch(() => false)
    return true
  }
}
