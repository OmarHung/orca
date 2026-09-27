import type { DatabaseConnectionSummary } from '../../shared/database/database-connection-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../shared/database/database-introspection-types'
import type {
  DatabaseError,
  DatabaseQueryResult,
  DatabaseResult,
  DatabaseRowsPage
} from '../../shared/database/database-query-types'
import type {
  DatabaseConsoleRef,
  DatabaseEncryptionStatus,
  DatabaseExecuteRequest,
  DatabaseFetchMoreRequest,
  DatabaseSaveConnectionRequest,
  DatabaseTestConnectionRequest
} from '../../shared/database/database-session-types'
import type { DatabaseConnectionStore } from './database-connection-store'
import type { DatabaseConsoleFiles } from './database-console-files'
import { NO_SECURE_PASSWORD_STORAGE, type DatabasePasswordVault } from './database-password-vault'
import type { DatabaseSessionManager } from './database-session-manager'

// 28P01 invalid_password, 28000 invalid_authorization_specification.
const AUTH_SQLSTATES = new Set(['28P01', '28000'])
const MISSING_PASSWORD_MESSAGE = /password must be a string|password authentication failed/i

function isPasswordRejection(error: DatabaseError): boolean {
  return (
    (error.sqlState !== undefined && AUTH_SQLSTATES.has(error.sqlState)) ||
    MISSING_PASSWORD_MESSAGE.test(error.message)
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
}

/** Main-side entry point for the Database page; the IPC layer only validates and forwards. */
export class DatabaseService {
  constructor(private readonly deps: DatabaseServiceDeps) {}

  listConnections(): DatabaseConnectionSummary[] {
    return this.deps.connections
      .list()
      .map((connection) => ({
        ...connection,
        hasSavedPassword: this.deps.passwords.has(connection.id)
      }))
  }

  encryptionStatus(): DatabaseEncryptionStatus {
    return this.deps.passwords.encryptionStatus()
  }

  saveConnection(
    request: DatabaseSaveConnectionRequest
  ): DatabaseResult<DatabaseConnectionSummary> {
    const { passwords } = this.deps
    const storage = request.draft.passwordStorage
    // Why re-file an existing password: switching storage mode must move it, not strand it.
    const password =
      request.password === undefined
        ? request.id
          ? passwords.get(request.id)
          : null
        : request.password
    if (
      storage === 'forever' &&
      password !== null &&
      !passwords.encryptionStatus().canStorePasswords
    ) {
      return { ok: false, error: { message: NO_SECURE_PASSWORD_STORAGE, code: 'unavailable' } }
    }
    const saved = this.deps.connections.save(request.id, request.draft)
    const stored =
      password === null
        ? passwords.forget(saved.id)
        : passwords.remember(saved.id, storage, password)
    if (!stored.ok) {
      return stored
    }
    return { ok: true, value: { ...saved, hasSavedPassword: passwords.has(saved.id) } }
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.deps.sessions.disconnect(connectionId)
    this.deps.passwords.forget(connectionId)
    this.deps.connections.delete(connectionId)
    await this.deps.consoles.deleteConnection(connectionId)
  }

  testConnection(
    request: DatabaseTestConnectionRequest
  ): Promise<DatabaseResult<{ serverVersion: string }>> {
    const password =
      request.password ??
      (request.connectionId ? this.deps.passwords.get(request.connectionId) : null)
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
    const password = promptedPassword ?? this.deps.passwords.get(connectionId)
    const result = await this.deps.sessions.connect(connection, password)
    if (!result.ok) {
      // Why: with no password we tried trust/.pgpass first; a rejection means ask the user.
      return isPasswordRejection(result.error)
        ? { ok: false, error: { ...result.error, code: 'password-required' } }
        : result
    }
    if (promptedPassword !== undefined) {
      if (connection.passwordStorage === 'forever') {
        this.deps.passwords.remember(connectionId, 'forever', promptedPassword)
      } else if (connection.passwordStorage === 'session') {
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

  execute(request: DatabaseExecuteRequest): Promise<DatabaseResult<DatabaseQueryResult>> {
    return this.deps.sessions.request(request.connectionId, {
      type: 'execute',
      consoleId: request.consoleId,
      sql: request.sql,
      pageSize: request.pageSize
    })
  }

  fetchMore(request: DatabaseFetchMoreRequest): Promise<DatabaseResult<DatabaseRowsPage>> {
    return this.deps.sessions.request(request.connectionId, {
      type: 'fetch',
      consoleId: request.consoleId,
      resultId: request.resultId,
      pageSize: request.pageSize
    })
  }

  async cancel(ref: DatabaseConsoleRef): Promise<boolean> {
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
