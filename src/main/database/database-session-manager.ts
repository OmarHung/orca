import type {
  DatabaseConnection,
  DatabaseConnectionDraft,
  DatabaseDriver
} from '../../shared/database/database-connection-types'
import type { DatabaseError, DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseSessionEvent } from '../../shared/database/database-session-types'
import { DatabaseWorkerClient, type DatabaseWorkerPort } from './database-worker-client'
import type {
  DatabaseWorkerCommandOf,
  DatabaseWorkerCommandType,
  DatabaseWorkerValues
} from './worker/database-worker-protocol'

const CLOSE_GRACE_MS = 2_000

type ConnectResult = DatabaseResult<{ serverVersion: string }>

type SessionEntry = {
  client: DatabaseWorkerClient
  serverVersion: string | null
  connecting: Promise<ConnectResult> | null
}

type SessionCommand = Exclude<DatabaseWorkerCommandType, 'connect' | 'close'>

const NOT_CONNECTED: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Not connected', code: 'not-connected' }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One worker per connected data source; state changes are pushed through `emit`. */
export class DatabaseSessionManager {
  private readonly sessions = new Map<string, SessionEntry>()

  constructor(
    private readonly deps: {
      spawnWorker: (driver: DatabaseDriver) => DatabaseWorkerPort
      emit: (event: DatabaseSessionEvent) => void
    }
  ) {}

  connect(connection: DatabaseConnection, password: string | null): Promise<ConnectResult> {
    const existing = this.sessions.get(connection.id)
    if (existing?.connecting) {
      return existing.connecting
    }
    if (existing?.serverVersion) {
      return Promise.resolve({ ok: true, value: { serverVersion: existing.serverVersion } })
    }
    const connectionId = connection.id
    this.deps.emit({ kind: 'session-state', connectionId, state: 'connecting' })
    let entry: SessionEntry
    try {
      const client = new DatabaseWorkerClient(this.deps.spawnWorker(connection.driver), (message) =>
        this.handleConnectionLost(connectionId, entry, message)
      )
      entry = { client, serverVersion: null, connecting: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.emit({ kind: 'session-state', connectionId, state: 'error', message })
      return Promise.resolve({ ok: false, error: { message, code: 'unavailable' } })
    }
    this.sessions.set(connectionId, entry)
    entry.connecting = entry.client
      .request({ type: 'connect', connection, password })
      .then((result) => this.settleConnect(connectionId, entry, result))
    return entry.connecting
  }

  /** Opens a throwaway worker so a failed test never disturbs a live session. */
  async test(draft: DatabaseConnectionDraft, password: string | null): Promise<ConnectResult> {
    let client: DatabaseWorkerClient
    try {
      client = new DatabaseWorkerClient(this.deps.spawnWorker(draft.driver), () => undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { message, code: 'unavailable' } }
    }
    try {
      const result = await client.request({ type: 'connect', connection: draft, password })
      if (result.ok) {
        await Promise.race([client.request({ type: 'close' }), delay(CLOSE_GRACE_MS)])
      }
      return result
    } finally {
      await client.terminate()
    }
  }

  request<T extends SessionCommand>(
    connectionId: string,
    command: DatabaseWorkerCommandOf<T>
  ): Promise<DatabaseResult<DatabaseWorkerValues[T]>> {
    const entry = this.sessions.get(connectionId)
    if (!entry?.serverVersion) {
      return Promise.resolve(NOT_CONNECTED)
    }
    return entry.client.request(command)
  }

  isConnected(connectionId: string): boolean {
    return Boolean(this.sessions.get(connectionId)?.serverVersion)
  }

  async disconnect(connectionId: string): Promise<void> {
    const entry = this.sessions.get(connectionId)
    if (!entry) {
      return
    }
    this.sessions.delete(connectionId)
    await Promise.race([entry.client.request({ type: 'close' }), delay(CLOSE_GRACE_MS)])
    await entry.client.terminate()
    this.deps.emit({ kind: 'session-state', connectionId, state: 'disconnected' })
  }

  /**
   * Kills the worker so a blocked synchronous statement (SQLite) stops; in-flight requests
   * settle with `reason`, and the next statement reconnects.
   */
  async restart(connectionId: string, reason: DatabaseError): Promise<boolean> {
    const entry = this.sessions.get(connectionId)
    if (!entry) {
      return false
    }
    this.sessions.delete(connectionId)
    // Why emit first: waiting for the worker to die must not delay the UI learning it's gone.
    this.deps.emit({ kind: 'session-state', connectionId, state: 'disconnected' })
    await entry.client.terminate(reason)
    return true
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)))
  }

  private settleConnect(
    connectionId: string,
    entry: SessionEntry,
    result: ConnectResult
  ): ConnectResult {
    entry.connecting = null
    if (this.sessions.get(connectionId) !== entry) {
      return { ok: false, error: { message: 'Connection was closed', code: 'unavailable' } }
    }
    if (result.ok) {
      entry.serverVersion = result.value.serverVersion
      this.deps.emit({
        kind: 'session-state',
        connectionId,
        state: 'connected',
        serverVersion: result.value.serverVersion
      })
      return result
    }
    this.sessions.delete(connectionId)
    void entry.client.terminate()
    this.deps.emit({
      kind: 'session-state',
      connectionId,
      state: 'error',
      message: result.error.message
    })
    return result
  }

  private handleConnectionLost(connectionId: string, entry: SessionEntry, message: string): void {
    if (this.sessions.get(connectionId) !== entry) {
      return
    }
    this.sessions.delete(connectionId)
    void entry.client.terminate()
    this.deps.emit({
      kind: 'session-state',
      connectionId,
      state: 'error',
      message: `Connection lost: ${message}`
    })
  }
}
