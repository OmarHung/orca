import { rm } from 'node:fs/promises'
import type {
  DatabaseDumpJobRequest,
  DatabaseDumpSummary,
  DatabaseDumpTool,
  DatabaseJobRef
} from '../../shared/database/database-dump-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseDumpDestinations } from './database-dump-destinations'
import type { DatabaseSessionManager } from './database-session-manager'

const EXPIRED: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Choose where to save the dump again; the earlier choice has expired.' }
}

/** Background jobs (dumps) on a connected session; progress arrives as events. */
export class DatabaseJobService {
  constructor(
    private readonly deps: {
      sessions: Pick<DatabaseSessionManager, 'request' | 'isConnected'>
      destinations: DatabaseDumpDestinations
    }
  ) {}

  async dump(request: DatabaseDumpJobRequest): Promise<DatabaseResult<DatabaseDumpSummary>> {
    const destination = this.deps.destinations.take(request.token)
    // Why check the kind: a file per table needs the folder chosen for it, not a file name.
    const perTable = request.dump.options.layout === 'file-per-table'
    if (!destination || perTable !== (destination.kind === 'folder')) {
      return EXPIRED
    }
    const result = await this.deps.sessions.request(request.connectionId, {
      type: 'dump',
      jobId: request.jobId,
      request: request.dump,
      destination
    })
    // Why here: a worker that died mid-dump (a SQLite restart, a crash) never removed what it
    // wrote. A live worker already did, and must not lose a file it never touched.
    const workerDied =
      !result.ok &&
      result.error.code !== 'not-connected' &&
      !this.deps.sessions.isConnected(request.connectionId)
    if (workerDied) {
      await rm(destination.path, { recursive: true, force: true }).catch(() => undefined)
    }
    return result
  }

  /** The pg_dump or mysqldump a native dump on this connection would run. */
  dumpTool(connectionId: string): Promise<DatabaseResult<DatabaseDumpTool | null>> {
    return this.deps.sessions.request(connectionId, { type: 'dumpTool' })
  }

  async cancelJob(ref: DatabaseJobRef): Promise<boolean> {
    const result = await this.deps.sessions.request(ref.connectionId, {
      type: 'cancelJob',
      jobId: ref.jobId
    })
    return result.ok && result.value.cancelled
  }
}
