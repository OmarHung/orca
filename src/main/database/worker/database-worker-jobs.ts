import type { DatabaseDumpSummary } from '../../../shared/database/database-dump-types'
import type { DatabaseDriverSession } from './database-driver'
import type { DatabaseWorkerCommandOf, DatabaseWorkerMessage } from './database-worker-protocol'
import type { DumpSource } from './dump/dump-source'
import { DumpOutput } from './dump/dump-output'
import { runDump } from './dump/dump-runner'

type RunningJob = { cancelled: boolean; source: DumpSource | null; done: Promise<unknown> }

/** Long-running work (dumps) on server sessions of its own, so consoles stay usable. */
export class DatabaseWorkerJobs {
  private readonly running = new Map<string, RunningJob>()

  constructor(private readonly post: (message: DatabaseWorkerMessage) => void) {}

  async dump(
    session: DatabaseDriverSession,
    { jobId, request, destination }: DatabaseWorkerCommandOf<'dump'>
  ): Promise<DatabaseDumpSummary> {
    if (this.running.has(jobId)) {
      throw new Error('This job is already running.')
    }
    const job: RunningJob = { cancelled: false, source: null, done: Promise.resolve() }
    this.running.set(jobId, job)
    const run = async (): Promise<DatabaseDumpSummary> => {
      const source = await session.openDumpSource(request.database)
      job.source = source
      try {
        return await runDump({
          source,
          request,
          output: new DumpOutput(destination, source.dialect),
          onProgress: (progress) =>
            this.post({ kind: 'job-progress', jobId, progress: { kind: 'dump', ...progress } }),
          isCancelled: () => job.cancelled
        })
      } finally {
        await source.close().catch(() => undefined)
      }
    }
    const done = run()
    job.done = done.catch(() => undefined)
    try {
      return await done
    } finally {
      this.running.delete(jobId)
    }
  }

  /** Cancels every job and waits for each to remove what it wrote, before the session closes. */
  async stopAll(): Promise<void> {
    const done = [...this.running.values()].map((job) => job.done)
    for (const jobId of this.running.keys()) {
      this.cancel(jobId)
    }
    await Promise.all(done)
  }

  /** Stops the job at its next batch, cutting short a read the server is still sending. */
  cancel(jobId: string): boolean {
    const job = this.running.get(jobId)
    if (!job) {
      return false
    }
    job.cancelled = true
    job.source?.cancel()
    return true
  }
}
