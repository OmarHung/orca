import type { DatabaseConnectionDraft } from './database-connection-types'
import type { DatabaseTransactionMode } from './database-query-types'
import type { TableChangeSet } from './table-change-sql'

export type DatabaseSessionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type DatabaseSessionEvent = {
  kind: 'session-state'
  connectionId: string
  state: DatabaseSessionState
  /** Why the session left `connected`, shown on the connection row. */
  message?: string
  serverVersion?: string
}

export type DatabaseSaveConnectionRequest = {
  /** Absent creates a new connection. */
  id?: string
  draft: DatabaseConnectionDraft
  /** `undefined` keeps the saved password, `null` forgets it. */
  password?: string | null
}

export type DatabaseTestConnectionRequest = {
  draft: DatabaseConnectionDraft
  /** Absent falls back to the password saved for `connectionId`. */
  password?: string
  connectionId?: string
}

export type DatabaseConsoleRef = { connectionId: string; consoleId: string }

export type DatabaseExecuteRequest = DatabaseConsoleRef & {
  sql: string
  pageSize: number
  /** Console runs go to query history; table browsing's generated queries don't. */
  recordHistory?: boolean
  /** Absent means auto-commit. */
  transactionMode?: DatabaseTransactionMode
  /** The schema (MySQL database) the console picked; absent keeps the connection's default. */
  schema?: string
  /** The database the console picked (PostgreSQL, SQL Server); absent keeps the connection's. */
  database?: string
}

export type DatabaseFetchMoreRequest = DatabaseConsoleRef & { resultId: string; pageSize: number }

export type DatabaseApplyChangesRequest = DatabaseConsoleRef & { changeSet: TableChangeSet }

export type DatabaseEncryptionStatus = {
  /** False means passwords can only be kept until Orca quits. */
  canStorePasswords: boolean
  /** Set when storage works but is weaker than a user would assume (e.g. Linux basic_text). */
  protectionGap: string | null
}

export const DATABASE_CONSOLE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
export const DATABASE_DEFAULT_PAGE_SIZE = 500
export const DATABASE_MAX_PAGE_SIZE = 10_000
