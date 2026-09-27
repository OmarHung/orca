import { translate } from '@/i18n/i18n'
import type {
  DatabaseExecuteResult,
  DatabaseResult,
  DatabaseTransactionMode
} from '../../../../../shared/database/database-query-types'
import { DATABASE_DEFAULT_PAGE_SIZE } from '../../../../../shared/database/database-session-types'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import type { DatabaseRunTarget } from '../database-page-tabs'

export type DatabaseRunOptions = {
  /** Console runs go to query history; the table view's generated queries don't. */
  recordHistory?: boolean
  /** Absent means auto-commit, as for the table view's queries. */
  transactionMode?: DatabaseTransactionMode
  /** The console's picked schema; absent keeps the connection's default. */
  schema?: string
}

export function transactionLostMessage(): string {
  return translate(
    'database.transaction.lost',
    'The connection closed, so the open transaction was rolled back. Nothing from it was saved.'
  )
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
      transactionMode: options.transactionMode,
      schema: options.schema
    })
  )
}

/**
 * Retries once after reconnecting when main dropped the session (e.g. a restarted SQLite
 * worker), except when an open transaction went with it: a fresh session would run the
 * statement without the changes before it.
 */
export async function executeReconnecting(
  tab: DatabaseRunTarget,
  sql: string,
  options: DatabaseRunOptions & { inTransaction: boolean }
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
  if (options.inTransaction) {
    return { ok: false, error: { message: transactionLostMessage(), transaction: 'none' } }
  }
  return (await connections.connect(tab.connectionId)) ? execute(tab, sql, options) : response
}
