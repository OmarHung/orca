import type { DatabaseConnectionSummary } from '../../shared/database/database-connection-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseResult,
  DatabaseRowsPage
} from '../../shared/database/database-query-types'
import type {
  DatabaseConsoleRef,
  DatabaseEncryptionStatus,
  DatabaseExecuteRequest,
  DatabaseFetchMoreRequest,
  DatabaseSaveConnectionRequest,
  DatabaseSessionEvent,
  DatabaseTestConnectionRequest
} from '../../shared/database/database-session-types'

export type DatabaseApi = {
  listConnections: () => Promise<DatabaseConnectionSummary[]>
  encryptionStatus: () => Promise<DatabaseEncryptionStatus>
  saveConnection: (
    request: DatabaseSaveConnectionRequest
  ) => Promise<DatabaseResult<DatabaseConnectionSummary>>
  deleteConnection: (connectionId: string) => Promise<void>
  testConnection: (
    request: DatabaseTestConnectionRequest
  ) => Promise<DatabaseResult<{ serverVersion: string }>>
  connect: (
    connectionId: string,
    password?: string
  ) => Promise<DatabaseResult<{ serverVersion: string }>>
  disconnect: (connectionId: string) => Promise<void>
  introspect: (
    connectionId: string,
    target: DatabaseIntrospectTarget
  ) => Promise<DatabaseResult<DatabaseIntrospectResult>>
  execute: (request: DatabaseExecuteRequest) => Promise<DatabaseResult<DatabaseExecuteResult>>
  fetchMore: (request: DatabaseFetchMoreRequest) => Promise<DatabaseResult<DatabaseRowsPage>>
  cancel: (ref: DatabaseConsoleRef) => Promise<boolean>
  closeConsole: (ref: DatabaseConsoleRef) => Promise<void>
  readConsole: (ref: DatabaseConsoleRef) => Promise<string>
  writeConsole: (ref: DatabaseConsoleRef, text: string) => Promise<void>
  /** Absolute path of the chosen SQLite file, or null when the dialog was cancelled. */
  pickSqliteFile: () => Promise<string | null>
  onEvent: (callback: (event: DatabaseSessionEvent) => void) => () => void
}
