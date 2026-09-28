import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget
} from '../../../shared/database/database-properties-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import type { DumpSource } from './dump/dump-source'

export type DatabaseExecuteOptions = {
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
  /** Settings of the server, a database, schema, table or view, read on the metadata session. */
  properties(target: DatabasePropertiesTarget): Promise<DatabaseObjectProperties>
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
  /** A session of its own for one dump, in `database` when given, else the connection's. */
  openDumpSource(database: string | undefined): Promise<DumpSource>
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
