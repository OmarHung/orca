import type {
  DatabaseDumpProgress,
  DatabaseDumpRequest,
  DatabaseDumpSummary
} from '../../../../../shared/database/database-dump-types'
import { DumpOutput, type DumpDestination } from '../dump-output'
import { mysqldumpPlan } from './mysqldump-plan'
import type { NativeDumpTarget } from './native-dump-plan'
import { NativeDumpRunner } from './native-dump-runner'
import { findDumpTool } from './native-dump-tools'
import { pgDumpPlan } from './pg-dump-plan'

export type NativeDumpJob = {
  target: NativeDumpTarget | null
  request: DatabaseDumpRequest
  destination: DumpDestination
  onProgress: (progress: DatabaseDumpProgress) => void
  isCancelled: () => boolean
  /** Receives the way to stop the tool once it is about to run. */
  onStop: (stop: () => void) => void
}

/** A dump written by pg_dump or mysqldump instead of Orca's own reader. */
export async function runNativeDump(job: NativeDumpJob): Promise<DatabaseDumpSummary> {
  const { target, request } = job
  if (!target) {
    throw new Error('pg_dump and mysqldump dump PostgreSQL and MySQL/MariaDB connections only.')
  }
  const { driver } = target.connection
  const tool = await findDumpTool({ driver, serverVersion: target.serverVersion })
  if (!tool) {
    throw new Error(
      `${driver === 'postgres' ? 'pg_dump' : 'mysqldump'} was not found. Install it, or use Orca’s built-in dump.`
    )
  }
  if (tool.problem) {
    throw new Error(tool.problem)
  }
  const plan =
    driver === 'postgres'
      ? pgDumpPlan({ tool, target, request })
      : await mysqldumpPlan({ tool, target, request })
  const runner = new NativeDumpRunner({
    plan,
    output: new DumpOutput(job.destination, driver),
    tableCount: request.objects.filter((object) => object.kind === 'table').length,
    onProgress: job.onProgress,
    isCancelled: job.isCancelled
  })
  job.onStop(() => runner.cancel())
  return runner.execute()
}
