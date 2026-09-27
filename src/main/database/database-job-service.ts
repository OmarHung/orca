import type { DatabaseResult } from '../../shared/database/database-query-types'
import type {
  DatabaseJobRef,
  DatabaseRunScriptRequest,
  DatabaseScriptSummary
} from '../../shared/database/database-script-types'
import type { DatabaseScriptPicks } from './database-script-picks'
import type { DatabaseSessionManager } from './database-session-manager'

/** Background jobs (running scripts) on a connected session; progress arrives as events. */
export class DatabaseJobService {
  constructor(
    private readonly deps: { sessions: DatabaseSessionManager; picks: DatabaseScriptPicks }
  ) {}

  runScript(request: DatabaseRunScriptRequest): Promise<DatabaseResult<DatabaseScriptSummary>> {
    const files = this.deps.picks.files(request.token)
    if (!files) {
      return Promise.resolve({
        ok: false,
        error: { message: 'Choose the script files again; the earlier choice has expired.' }
      })
    }
    return this.deps.sessions.request(request.connectionId, {
      type: 'runScript',
      jobId: request.jobId,
      files,
      options: request.options
    })
  }

  async cancelJob(ref: DatabaseJobRef): Promise<boolean> {
    const result = await this.deps.sessions.request(ref.connectionId, {
      type: 'cancelJob',
      jobId: ref.jobId
    })
    return result.ok && result.value.cancelled
  }
}
