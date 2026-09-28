import type { DatabaseConnectionSummary } from '../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../shared/database/database-ddl-types'
import type { DatabaseSaveExportRequest } from '../../shared/database/database-export-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../shared/database/database-introspection-types'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget
} from '../../shared/database/database-properties-types'
import type { DatabaseHistoryEntry } from '../../shared/database/database-query-history-types'
import type {
  DatabaseExecuteResult,
  DatabaseLongValues,
  DatabaseResult,
  DatabaseRowsPage
} from '../../shared/database/database-query-types'
import type {
  DatabaseConsoleRef,
  DatabaseEncryptionStatus,
  DatabaseExecuteRequest,
  DatabaseFetchMoreRequest,
  DatabasePageEvent,
  DatabaseReadLongValuesRequest,
  DatabaseSaveConnectionRequest,
  DatabaseTestConnectionRequest
} from '../../shared/database/database-session-types'
import type {
  DatabaseDumpDestination,
  DatabaseDumpJobRequest,
  DatabaseDumpSummary,
  DatabaseDumpTool,
  DatabaseJobRef,
  DatabasePickDumpDestinationRequest
} from '../../shared/database/database-dump-types'

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
  /** Settings of the server, a database, schema, table or view: engine, collation, sizes… */
  properties: (
    connectionId: string,
    target: DatabasePropertiesTarget
  ) => Promise<DatabaseResult<DatabaseObjectProperties>>
  execute: (request: DatabaseExecuteRequest) => Promise<DatabaseResult<DatabaseExecuteResult>>
  fetchMore: (request: DatabaseFetchMoreRequest) => Promise<DatabaseResult<DatabaseRowsPage>>
  /** Slices of values a result shipped only as previews, for copy and export. */
  readLongValues: (
    request: DatabaseReadLongValuesRequest
  ) => Promise<DatabaseResult<DatabaseLongValues>>
  /** Console statements for a connection, newest first. */
  listHistory: (connectionId: string) => Promise<DatabaseHistoryEntry[]>
  clearHistory: (connectionId: string) => Promise<void>
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
  /** Asks where a dump goes; null when the dialog was cancelled. */
  pickDumpDestination: (
    request: DatabasePickDumpDestinationRequest
  ) => Promise<DatabaseDumpDestination | null>
  /** Resolves when the whole dump ends; progress arrives as `job-progress` events. */
  dump: (request: DatabaseDumpJobRequest) => Promise<DatabaseResult<DatabaseDumpSummary>>
  cancelJob: (ref: DatabaseJobRef) => Promise<boolean>
  /** The pg_dump or mysqldump a native dump would run; null when none is found or applies. */
  dumpTool: (connectionId: string) => Promise<DatabaseResult<DatabaseDumpTool | null>>
  onEvent: (callback: (event: DatabasePageEvent) => void) => () => void
}
