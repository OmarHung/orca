import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage,
  DatabaseTransactionMode
} from '../../../shared/database/database-query-types'

export type DatabaseExecuteOptions = {
  mode: DatabaseTransactionMode
  /** Where unqualified names should resolve; ignored by drivers with no per-session switch. */
  schema?: string
  /** The console's database (PostgreSQL, SQL Server); ignored where a server holds one. */
  database?: string
}

/**
 * One open data source. Each console gets its own server session so a half-read result
 * in one console never blocks another, and metadata queries run on a separate session.
 */
export type DatabaseDriverSession = {
  readonly serverVersion: string
  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult>
  /** The CREATE statements for a table, view or routine, read on the metadata session. */
  ddl(target: DatabaseDdlTarget): Promise<string>
  execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    options: DatabaseExecuteOptions
  ): Promise<DatabaseExecuteResult>
  fetch(consoleId: string, resultId: string, pageSize: number): Promise<DatabaseRowsPage>
  /** Resolves true when the server accepted the cancel request. */
  cancel(consoleId: string): Promise<boolean>
  closeConsole(consoleId: string): Promise<void>
  close(): Promise<void>
}

export type DatabaseDriverCallbacks = {
  onConnectionLost: (message: string) => void
}

export type OpenDatabaseDriverSession = (
  connection: DatabaseConnectionDraft,
  password: string | null,
  callbacks: DatabaseDriverCallbacks
) => Promise<DatabaseDriverSession>
