import {
  databasePasswordStorage,
  type DatabaseConnection,
  type DatabaseConnectionDraft,
  type DatabaseConnectionSummary
} from '../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../shared/database/database-introspection-types'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget
} from '../../shared/database/database-properties-types'
import type {
  DatabaseError,
  DatabaseExecuteResult,
  DatabaseLongValues,
  DatabaseResult,
  DatabaseRowsPage
} from '../../shared/database/database-query-types'
import type { DatabaseHistoryEntry } from '../../shared/database/database-query-history-types'
import type {
  DatabaseConsoleRef,
  DatabaseEncryptionStatus,
  DatabaseExecuteRequest,
  DatabaseFetchMoreRequest,
  DatabaseReadLongValuesRequest,
  DatabaseSaveConnectionRequest,
  DatabaseSetConnectionGroupRequest,
  DatabaseTestConnectionRequest
} from '../../shared/database/database-session-types'
import { saveConnectionWithPassword } from './database-connection-save'
import type { DatabaseConnectionStore } from './database-connection-store'
import type { DatabaseConsoleFiles } from './database-console-files'
import type { DatabaseQueryHistory } from './database-query-history'
import { NO_SECURE_PASSWORD_STORAGE, type DatabasePasswordVault } from './database-password-vault'
import type { DatabaseSessionManager } from './database-session-manager'

// 28P01 invalid_password, 28000 invalid_authorization_specification, SQL Server's 18456.
const AUTH_SQLSTATES = new Set(['28P01', '28000', '18456'])
const MISSING_PASSWORD_MESSAGE =
  /password must be a string|password authentication failed|Login failed for user/i

function isPasswordRejection(error: DatabaseError): boolean {
  if (error.code === 'password-required') {
    return true
  }
  // Why the message only without a code: SQL Server's 4060 "Cannot open database" ends in
  // "Login failed for user" too.
  return error.sqlState !== undefined
    ? AUTH_SQLSTATES.has(error.sqlState)
    : MISSING_PASSWORD_MESSAGE.test(error.message)
}

// Draft fields a live session doesn't depend on.
const SESSION_NEUTRAL_FIELDS = new Set(['name', 'color', 'group', 'passwordStorage'])

function changesSessionSettings(
  previous: DatabaseConnection,
  next: DatabaseConnectionDraft
): boolean {
  return Object.entries(next).some(
    ([key, value]) =>
      !SESSION_NEUTRAL_FIELDS.has(key) &&
      JSON.stringify(value) !== JSON.stringify(Reflect.get(previous, key))
  )
}

function unknownConnection(): DatabaseResult<never> {
  return { ok: false, error: { message: 'This connection no longer exists.', code: 'unavailable' } }
}

export type DatabaseServiceDeps = {
  connections: DatabaseConnectionStore
  passwords: DatabasePasswordVault
  sessions: DatabaseSessionManager
  consoles: DatabaseConsoleFiles
  history: DatabaseQueryHistory
}

/** Main-side entry point for the Database page; the IPC layer only validates and forwards. */
export class DatabaseService {
  constructor(private readonly deps: DatabaseServiceDeps) {}

  listConnections(): DatabaseConnectionSummary[] {
    return this.deps.connections.list().map((connection) => ({
      ...connection,
      hasSavedPassword: this.deps.passwords.has(connection.id)
    }))
  }

  encryptionStatus(): DatabaseEncryptionStatus {
    return this.deps.passwords.encryptionStatus()
  }

  async saveConnection(
    request: DatabaseSaveConnectionRequest
  ): Promise<DatabaseResult<DatabaseConnectionSummary>> {
    const { passwords } = this.deps
    const storage = databasePasswordStorage(request.draft)
    // Why three states: undefined keeps (or moves) the password already kept, null clears it.
    const { password } = request
    if (
      storage === 'forever' &&
      typeof password === 'string' &&
      !passwords.encryptionStatus().canStorePasswords
    ) {
      return { ok: false, error: { message: NO_SECURE_PASSWORD_STORAGE, code: 'unavailable' } }
    }
    const previous = request.id ? this.deps.connections.get(request.id) : null
    const saved = saveConnectionWithPassword(this.deps, previous, request.draft, storage, password)
    if (!saved.ok) {
      return saved
    }
    // Why: a session opened with the old host or user would silently keep them.
    if (previous && changesSessionSettings(previous, request.draft)) {
      await this.deps.sessions.disconnect(saved.value.id)
    }
    return {
      ok: true,
      value: { ...saved.value, hasSavedPassword: passwords.has(saved.value.id) }
    }
  }

  /** Regrouping is cosmetic: open sessions stay. */
  setConnectionGroup(request: DatabaseSetConnectionGroupRequest): void {
    this.deps.connections.setGroup(request.connectionIds, request.group)
  }

  async deleteConnection(connectionId: string): Promise<DatabaseResult<null>> {
    await this.deps.sessions.disconnect(connectionId)
    // Why first: a connection deleted before its password would leave that password with nothing to remove it from.
    const forgotten = this.deps.passwords.forget(connectionId)
    if (!forgotten.ok) {
      return forgotten
    }
    this.deps.connections.delete(connectionId)
    await this.deps.consoles.deleteConnection(connectionId)
    await this.deps.history.clear(connectionId)
    return { ok: true, value: null }
  }

  testConnection(
    request: DatabaseTestConnectionRequest
  ): Promise<DatabaseResult<{ serverVersion: string }>> {
    const password =
      request.password ??
      (request.connectionId && databasePasswordStorage(request.draft) !== 'never'
        ? this.deps.passwords.get(request.connectionId)
        : null)
    return this.deps.sessions.test(request.draft, password)
  }

  async connect(
    connectionId: string,
    promptedPassword?: string
  ): Promise<DatabaseResult<{ serverVersion: string }>> {
    const connection = this.deps.connections.get(connectionId)
    if (!connection) {
      return unknownConnection()
    }
    // Why: "Never" must not use a password, even one a failed removal left on disk.
    const password =
      promptedPassword ??
      (databasePasswordStorage(connection) === 'never'
        ? null
        : this.deps.passwords.get(connectionId))
    const result = await this.deps.sessions.connect(connection, password)
    if (!result.ok) {
      // Why: with no password we tried trust/.pgpass first; a rejection means ask the user.
      return isPasswordRejection(result.error)
        ? { ok: false, error: { ...result.error, code: 'password-required' } }
        : result
    }
    if (promptedPassword !== undefined) {
      if (databasePasswordStorage(connection) === 'forever') {
        this.deps.passwords.remember(connectionId, 'forever', promptedPassword)
      } else if (databasePasswordStorage(connection) === 'session') {
        this.deps.passwords.rememberForSession(connectionId, promptedPassword)
      }
    }
    return result
  }

  disconnect(connectionId: string): Promise<void> {
    return this.deps.sessions.disconnect(connectionId)
  }

  introspect(
    connectionId: string,
    target: DatabaseIntrospectTarget
  ): Promise<DatabaseResult<DatabaseIntrospectResult>> {
    return this.deps.sessions.request(connectionId, { type: 'introspect', target })
  }

  async ddl(connectionId: string, target: DatabaseDdlTarget): Promise<DatabaseResult<string>> {
    const result = await this.deps.sessions.request(connectionId, { type: 'ddl', target })
    return result.ok ? { ok: true, value: result.value.ddl } : result
  }

  properties(
    connectionId: string,
    target: DatabasePropertiesTarget
  ): Promise<DatabaseResult<DatabaseObjectProperties>> {
    return this.deps.sessions.request(connectionId, { type: 'properties', target })
  }

  async execute(request: DatabaseExecuteRequest): Promise<DatabaseResult<DatabaseExecuteResult>> {
    const startedAt = Date.now()
    const result = await this.deps.sessions.request(request.connectionId, {
      type: 'execute',
      consoleId: request.consoleId,
      sql: request.sql,
      pageSize: request.pageSize,
      schema: request.schema,
      database: request.database
    })
    if (request.recordHistory && this.deps.connections.get(request.connectionId)) {
      const finishedAt = Date.now()
      const outcome = result.ok ? 'ok' : result.error.code === 'cancelled' ? 'cancelled' : 'error'
      // Why not awaited: a history write must never delay or fail the statement's result.
      this.deps.history
        .record(request.connectionId, {
          sql: request.sql,
          at: finishedAt,
          outcome,
          durationMs: finishedAt - startedAt
        })
        .catch((error: unknown) => console.warn('[database] query history write failed', error))
    }
    return result
  }

  listHistory(connectionId: string): Promise<DatabaseHistoryEntry[]> {
    return this.deps.history.list(connectionId)
  }

  clearHistory(connectionId: string): Promise<void> {
    return this.deps.history.clear(connectionId)
  }

  fetchMore(request: DatabaseFetchMoreRequest): Promise<DatabaseResult<DatabaseRowsPage>> {
    return this.deps.sessions.request(request.connectionId, {
      type: 'fetch',
      consoleId: request.consoleId,
      resultId: request.resultId,
      pageSize: request.pageSize
    })
  }

  readLongValues(
    request: DatabaseReadLongValuesRequest
  ): Promise<DatabaseResult<DatabaseLongValues>> {
    return this.deps.sessions.request(request.connectionId, {
      type: 'readValues',
      consoleId: request.consoleId,
      resultId: request.resultId,
      slices: request.slices
    })
  }

  async cancel(ref: DatabaseConsoleRef): Promise<boolean> {
    if (this.deps.connections.get(ref.connectionId)?.driver === 'sqlite') {
      // Why restart: SQLite runs synchronously in its worker, so no cancel message gets through.
      return this.deps.sessions.restart(ref.connectionId, {
        message: 'Cancelled. The SQLite connection was restarted to stop the statement.',
        code: 'cancelled'
      })
    }
    const result = await this.deps.sessions.request(ref.connectionId, {
      type: 'cancel',
      consoleId: ref.consoleId
    })
    return result.ok && result.value.cancelled
  }

  async closeConsole(ref: DatabaseConsoleRef): Promise<void> {
    await this.deps.sessions.request(ref.connectionId, {
      type: 'closeConsole',
      consoleId: ref.consoleId
    })
  }

  readConsole(ref: DatabaseConsoleRef): Promise<string> {
    return this.deps.consoles.read(ref.connectionId, ref.consoleId)
  }

  writeConsole(ref: DatabaseConsoleRef, text: string): void {
    this.deps.consoles.write(ref.connectionId, ref.consoleId, text)
  }

  disposeAll(): Promise<void> {
    return this.deps.sessions.disposeAll()
  }
}
