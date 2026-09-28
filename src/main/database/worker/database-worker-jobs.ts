import type {
  DatabaseDumpProgress,
  DatabaseDumpSummary
} from '../../../shared/database/database-dump-types'
import type { DatabaseDriverSession } from './database-driver'
import type { DatabaseWorkerCommandOf, DatabaseWorkerMessage } from './database-worker-protocol'
import { DumpOutput } from './dump/dump-output'
import { runDump } from './dump/dump-runner'
import { runNativeDump } from './dump/native/native-dump-job'
import type { NativeDumpTarget } from './dump/native/native-dump-plan'

type RunningJob = { cancelled: boolean; stop: (() => void) | null; done: Promise<unknown> }

/** Long-running work (dumps) on server sessions of its own, so consoles stay usable. */
export class DatabaseWorkerJobs {
  private readonly running = new Map<string, RunningJob>()

  constructor(private readonly post: (message: DatabaseWorkerMessage) => void) {}

  async dump(
    session: DatabaseDriverSession,
    { jobId, request, destination }: DatabaseWorkerCommandOf<'dump'>,
    nativeTarget: NativeDumpTarget | null
  ): Promise<DatabaseDumpSummary> {
    if (this.running.has(jobId)) {
      throw new Error('This job is already running.')
    }
    const job: RunningJob = { cancelled: false, stop: null, done: Promise.resolve() }
    this.running.set(jobId, job)
    const onProgress = (progress: DatabaseDumpProgress): void =>
      this.post({ kind: 'job-progress', jobId, progress: { kind: 'dump', ...progress } })
    const isCancelled = (): boolean => job.cancelled
    const run = async (): Promise<DatabaseDumpSummary> => {
      if (request.options.engine === 'native') {
        return runNativeDump({
          jobId,
          target: nativeTarget,
          request,
          destination,
          onProgress,
          isCancelled,
          onStop: (stop) => {
            job.stop = stop
          }
        })
      }
      const source = await session.openDumpSource(request.database)
      job.stop = () => source.cancel()
      try {
        return await runDump({
          source,
          request,
          output: new DumpOutput(destination, source.dialect, jobId),
          onProgress,
          isCancelled
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
    job.stop?.()
    return true
  }
}
