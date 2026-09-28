import { rmSync } from 'node:fs'
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
import { partialDumpPath } from './worker/dump/dump-output'

const EXPIRED: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Choose where to save the dump again; the earlier choice has expired.' }
}

/** Background jobs (dumps) on a connected session; progress arrives as events. */
export class DatabaseJobService {
  /** Each running dump's partial output, by job id. */
  private readonly partials = new Map<string, string>()

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
    const partial = partialDumpPath(destination, request.jobId)
    this.partials.set(request.jobId, partial)
    try {
      const result = await this.deps.sessions.request(request.connectionId, {
        type: 'dump',
        jobId: request.jobId,
        request: request.dump,
        destination
      })
      // Why here: a worker that died mid-dump (a SQLite restart, a crash) never removed its
      // partial output. The destination itself is only ever replaced by a finished dump.
      const workerDied =
        !result.ok &&
        result.error.code !== 'not-connected' &&
        !this.deps.sessions.isConnected(request.connectionId)
      if (workerDied) {
        await rm(partial, { recursive: true, force: true }).catch(() => undefined)
      }
      return result
    } finally {
      this.partials.delete(request.jobId)
    }
  }

  /** On quit: removes running dumps' partial output, since their workers end with the app. */
  discardRunning(): void {
    for (const partial of this.partials.values()) {
      try {
        rmSync(partial, { recursive: true, force: true })
      } catch {
        // Best effort: the partial's name already says it isn't a finished dump.
      }
    }
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
