import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseResult,
  DatabaseRowsPage,
  DatabaseTransactionMode
} from '../../../shared/database/database-query-types'
import type { TableChangeSet } from '../../../shared/database/table-change-sql'

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
      transactionMode?: DatabaseTransactionMode
    }
  | { type: 'fetch'; consoleId: string; resultId: string; pageSize: number }
  | { type: 'applyChanges'; consoleId: string; changeSet: TableChangeSet }
  | { type: 'cancel'; consoleId: string }
  | { type: 'closeConsole'; consoleId: string }
  | { type: 'close' }

export type DatabaseWorkerValues = {
  connect: { serverVersion: string }
  introspect: DatabaseIntrospectResult
  ddl: { ddl: string }
  execute: DatabaseExecuteResult
  fetch: DatabaseRowsPage
  applyChanges: { applied: number }
  cancel: { cancelled: boolean }
  closeConsole: null
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
