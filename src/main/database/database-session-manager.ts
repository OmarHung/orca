import { randomUUID } from 'node:crypto'
import {
  isServerConnection,
  type DatabaseConnection,
  type DatabaseConnectionDraft,
  type DatabaseDriver
} from '../../shared/database/database-connection-types'
import type { DatabaseError, DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseSessionEvent } from '../../shared/database/database-session-types'
import type { DatabaseJobEvent } from '../../shared/database/database-dump-types'
import { DatabaseWorkerClient, type DatabaseWorkerPort } from './database-worker-client'
import type {
  DatabaseWorkerCommandOf,
  DatabaseWorkerCommandType,
  DatabaseWorkerValues
} from './worker/database-worker-protocol'

const CLOSE_GRACE_MS = 2_000

type ConnectResult = DatabaseResult<{ serverVersion: string }>

/** A local port that reaches a connection's server through its SSH host. */
export type DatabaseTunnel = { localPort: number; close: () => Promise<void> }

export type OpenDatabaseTunnel = (
  request: { key: string; targetId: string; remoteHost: string; remotePort: number },
  /** Called at most once if the tunnel goes away on its own. */
  onLost: (message: string) => void
) => Promise<DatabaseTunnel>

type Route = { ok: true; tunnel: DatabaseTunnel | null } | { ok: false; error: DatabaseError }

type SessionEntry = {
  client: DatabaseWorkerClient
  serverVersion: string | null
  connecting: Promise<ConnectResult> | null
  tunnel: DatabaseTunnel | null
  /** Why the session ended on its own, so a connect it cut short can say so. */
  lostReason: string | null
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
      emitJobProgress?: (event: DatabaseJobEvent) => void
      /** Absent where Orca has no SSH stack (e.g. tests): tunneled connections then fail. */
      openTunnel?: OpenDatabaseTunnel
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
      const client = new DatabaseWorkerClient(
        this.deps.spawnWorker(connection.driver),
        (message) => this.handleConnectionLost(connectionId, entry, message),
        (jobId, progress) =>
          this.deps.emitJobProgress?.({ kind: 'job-progress', connectionId, jobId, progress })
      )
      entry = { client, serverVersion: null, connecting: null, tunnel: null, lostReason: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.emit({ kind: 'session-state', connectionId, state: 'error', message })
      return Promise.resolve({ ok: false, error: { message, code: 'unavailable' } })
    }
    this.sessions.set(connectionId, entry)
    entry.connecting = this.openRoute(connection, connectionId, (message) =>
      this.handleConnectionLost(connectionId, entry, message)
    )
      .then((route): Promise<ConnectResult> | ConnectResult => {
        if (!route.ok) {
          return { ok: false, error: route.error }
        }
        entry.tunnel = route.tunnel
        return entry.client.request({
          type: 'connect',
          connection,
          password,
          tunnelPort: route.tunnel?.localPort
        })
      })
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
    const route = await this.openRoute(draft, `test:${randomUUID()}`, () => undefined)
    try {
      if (!route.ok) {
        return { ok: false, error: route.error }
      }
      const result = await client.request({
        type: 'connect',
        connection: draft,
        password,
        tunnelPort: route.tunnel?.localPort
      })
      if (result.ok) {
        await Promise.race([client.request({ type: 'close' }), delay(CLOSE_GRACE_MS)])
      }
      return result
    } finally {
      await client.terminate()
      await (route.ok ? route.tunnel?.close() : undefined)
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
    await entry.tunnel?.close()
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
    await entry.tunnel?.close()
    return true
  }

  /** Opens the connection's SSH tunnel, if it has one, before the worker dials it. */
  private async openRoute(
    draft: DatabaseConnectionDraft,
    key: string,
    onLost: (message: string) => void
  ): Promise<Route> {
    if (!isServerConnection(draft) || !draft.sshTunnel) {
      return { ok: true, tunnel: null }
    }
    const { sshTunnel } = draft
    if (!this.deps.openTunnel) {
      return {
        ok: false,
        error: { message: 'SSH tunnels are not available here.', code: 'unavailable' }
      }
    }
    try {
      const tunnel = await this.deps.openTunnel(
        { key, targetId: sshTunnel.targetId, remoteHost: draft.host, remotePort: draft.port },
        onLost
      )
      return { ok: true, tunnel }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { message: `SSH tunnel: ${message}` } }
    }
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
      void entry.tunnel?.close()
      return {
        ok: false,
        error: { message: entry.lostReason ?? 'Connection was closed', code: 'unavailable' }
      }
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
    void entry.tunnel?.close()
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
    void entry.tunnel?.close()
    // Why the check: mysql2's own message already starts with "Connection lost:".
    entry.lostReason = /^connection lost/i.test(message) ? message : `Connection lost: ${message}`
    this.deps.emit({
      kind: 'session-state',
      connectionId,
      state: 'error',
      message: entry.lostReason
    })
  }
}
