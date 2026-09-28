import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseLongValueSlice,
  DatabaseLongValues,
  DatabaseResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import type {
  DatabaseDumpRequest,
  DatabaseDumpSummary,
  DatabaseDumpTool,
  DatabaseJobProgress
} from '../../../shared/database/database-dump-types'
import type { DumpDestination } from './dump/dump-output'

// Must stay electron-free: imported by the worker thread entry.

export type DatabaseWorkerCommand =
  | {
      type: 'connect'
      connection: DatabaseConnectionDraft
      password: string | null
      /** Local end of the connection's SSH tunnel, when it has one. */
      tunnelPort?: number
    }
  | { type: 'introspect'; target: DatabaseIntrospectTarget }
  | { type: 'ddl'; target: DatabaseDdlTarget }
  | {
      type: 'execute'
      consoleId: string
      sql: string
      pageSize: number
      schema?: string
      database?: string
    }
  | { type: 'fetch'; consoleId: string; resultId: string; pageSize: number }
  /** Slices of values the rows carried only as previews; bounded per read. */
  | { type: 'readValues'; consoleId: string; resultId: string; slices: DatabaseLongValueSlice[] }
  | { type: 'cancel'; consoleId: string }
  | { type: 'closeConsole'; consoleId: string }
  /** Dumps on a session of the job's own, reporting `job-progress` as it goes. */
  | {
      type: 'dump'
      jobId: string
      request: DatabaseDumpRequest
      destination: DumpDestination
    }
  | { type: 'cancelJob'; jobId: string }
  /** The pg_dump or mysqldump a native dump would run; null for other databases or none found. */
  | { type: 'dumpTool' }
  | { type: 'close' }

export type DatabaseWorkerValues = {
  connect: { serverVersion: string }
  introspect: DatabaseIntrospectResult
  ddl: { ddl: string }
  execute: DatabaseExecuteResult
  fetch: DatabaseRowsPage
  readValues: DatabaseLongValues
  cancel: { cancelled: boolean }
  closeConsole: null
  dump: DatabaseDumpSummary
  cancelJob: { cancelled: boolean }
  dumpTool: DatabaseDumpTool | null
  close: null
}

export type DatabaseWorkerCommandType = DatabaseWorkerCommand['type']

export type DatabaseWorkerCommandOf<T extends DatabaseWorkerCommandType> = Extract<
  DatabaseWorkerCommand,
  { type: T }
>

export type DatabaseWorkerRequest = { id: number; command: DatabaseWorkerCommand }

export type DatabaseWorkerMessage =
  | { kind: 'response'; id: number; result: DatabaseResult<unknown> }
  /** The server connection dropped outside any request (restart, network loss). */
  | { kind: 'connection-lost'; message: string }
  | { kind: 'job-progress'; jobId: string; progress: DatabaseJobProgress }
