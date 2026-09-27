import type { DatabaseConnectionSummary } from '../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../shared/database/database-ddl-types'
import type { DatabaseSaveExportRequest } from '../../shared/database/database-export-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../shared/database/database-introspection-types'
import type { DatabaseHistoryEntry } from '../../shared/database/database-query-history-types'
import type {
  DatabaseJobRef,
  DatabasePickedScripts,
  DatabaseRunScriptRequest,
  DatabaseScriptSummary
} from '../../shared/database/database-script-types'
import type {
  DatabaseExecuteResult,
  DatabaseResult,
  DatabaseRowsPage
} from '../../shared/database/database-query-types'
import type {
  DatabaseApplyChangesRequest,
  DatabaseConsoleRef,
  DatabaseEncryptionStatus,
  DatabaseExecuteRequest,
  DatabaseFetchMoreRequest,
  DatabasePageEvent,
  DatabaseSaveConnectionRequest,
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
  /** CREATE statements for a table, view or routine. */
  ddl: (connectionId: string, target: DatabaseDdlTarget) => Promise<DatabaseResult<string>>
  execute: (request: DatabaseExecuteRequest) => Promise<DatabaseResult<DatabaseExecuteResult>>
  fetchMore: (request: DatabaseFetchMoreRequest) => Promise<DatabaseResult<DatabaseRowsPage>>
  /** Console statements for a connection, newest first. */
  listHistory: (connectionId: string) => Promise<DatabaseHistoryEntry[]>
  clearHistory: (connectionId: string) => Promise<void>
  /** Applies table edits in one transaction; see `table-change-sql`. */
  applyChanges: (
    request: DatabaseApplyChangesRequest
  ) => Promise<DatabaseResult<{ applied: number }>>
  cancel: (ref: DatabaseConsoleRef) => Promise<boolean>
  closeConsole: (ref: DatabaseConsoleRef) => Promise<void>
  readConsole: (ref: DatabaseConsoleRef) => Promise<string>
  writeConsole: (ref: DatabaseConsoleRef, text: string) => Promise<void>
  /** Absolute path of the chosen SQLite file, or null when the dialog was cancelled. */
  pickSqliteFile: () => Promise<string | null>
  /** Resolves to `null` when the save dialog was cancelled. */
  saveExport: (
    request: DatabaseSaveExportRequest
  ) => Promise<DatabaseResult<{ filePath: string } | null>>
  /** Opens the script picker; null when it was cancelled. */
  pickScripts: () => Promise<DatabasePickedScripts | null>
  /** Resolves when the whole run ends; progress arrives as `job-progress` events. */
  runScript: (request: DatabaseRunScriptRequest) => Promise<DatabaseResult<DatabaseScriptSummary>>
  cancelJob: (ref: DatabaseJobRef) => Promise<boolean>
  onEvent: (callback: (event: DatabasePageEvent) => void) => () => void
}
