import type {
  DatabaseExecuteResult,
  DatabaseResult
} from '../../../../../shared/database/database-query-types'
import { DATABASE_DEFAULT_PAGE_SIZE } from '../../../../../shared/database/database-session-types'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import type { DatabaseRunTarget } from '../database-page-tabs'

export type DatabaseRunOptions = {
  /** Console runs go to query history; the table view's generated queries don't. */
  recordHistory?: boolean
  /** The console's picked schema; absent keeps the connection's default. */
  schema?: string
  /** The console's picked database (PostgreSQL, SQL Server); absent keeps the connection's. */
  database?: string
}

async function execute(
  tab: DatabaseRunTarget,
  sql: string,
  options: DatabaseRunOptions
): Promise<DatabaseResult<DatabaseExecuteResult>> {
  return asDatabaseResult(
    await window.api.database.execute({
      connectionId: tab.connectionId,
      consoleId: tab.consoleId,
      sql,
      pageSize: DATABASE_DEFAULT_PAGE_SIZE,
      recordHistory: options.recordHistory,
      schema: options.schema,
      database: options.database
    })
  )
}

/** Retries once after reconnecting when main dropped the session (e.g. a restarted SQLite worker). */
export async function executeReconnecting(
  tab: DatabaseRunTarget,
  sql: string,
  options: DatabaseRunOptions
): Promise<DatabaseResult<DatabaseExecuteResult>> {
  const response = await execute(tab, sql, options)
  if (response.ok || response.error.code !== 'not-connected') {
    return response
  }
  const connections = useDatabaseConnectionsStore.getState()
  connections.applySessionEvent({
    kind: 'session-state',
    connectionId: tab.connectionId,
    state: 'disconnected'
  })
  return (await connections.connect(tab.connectionId)) ? execute(tab, sql, options) : response
}
