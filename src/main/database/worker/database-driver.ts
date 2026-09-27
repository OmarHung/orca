import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseQueryResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'

/**
 * One open data source. Each console gets its own server session so a half-read result
 * in one console never blocks another, and metadata queries run on a separate session.
 */
export type DatabaseDriverSession = {
  readonly serverVersion: string
  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult>
  execute(consoleId: string, sql: string, pageSize: number): Promise<DatabaseQueryResult>
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
