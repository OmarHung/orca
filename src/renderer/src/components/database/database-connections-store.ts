import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import type { DatabaseConnectionSummary } from '../../../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../../../shared/database/database-query-types'
import type {
  DatabaseSessionEvent,
  DatabaseSessionState
} from '../../../../shared/database/database-session-types'

export type DatabaseSessionStatus = {
  state: DatabaseSessionState
  message?: string
  serverVersion?: string
}

type PasswordPrompt = { connectionId: string; error: string | null }

type DatabaseConnectionsState = {
  loaded: boolean
  connections: DatabaseConnectionSummary[]
  sessions: Record<string, DatabaseSessionStatus>
  passwordPrompt: PasswordPrompt | null
  refresh: () => Promise<void>
  /** Resolves true once connected; a missing password opens the prompt instead. */
  connect: (connectionId: string, password?: string) => Promise<boolean>
  disconnect: (connectionId: string) => Promise<void>
  applySessionEvent: (event: DatabaseSessionEvent) => void
  dismissPasswordPrompt: () => void
}

/** The web client proxies unknown APIs to `undefined`; treat that as a failure, not a crash. */
export function asDatabaseResult<T>(value: DatabaseResult<T> | undefined): DatabaseResult<T> {
  if (value && typeof value === 'object' && 'ok' in value) {
    return value
  }
  return {
    ok: false,
    error: {
      message: translate(
        'database.page.desktopOnly',
        'Databases are available in the desktop app only.'
      ),
      code: 'unavailable'
    }
  }
}

export const useDatabaseConnectionsStore = create<DatabaseConnectionsState>((set, get) => ({
  loaded: false,
  connections: [],
  sessions: {},
  passwordPrompt: null,

  refresh: async () => {
    const connections = await window.api.database.listConnections()
    set({ loaded: true, connections: Array.isArray(connections) ? connections : [] })
  },

  connect: async (connectionId, password) => {
    const status = get().sessions[connectionId]?.state
    if (status === 'connected') {
      return true
    }
    const result = asDatabaseResult(await window.api.database.connect(connectionId, password))
    if (result.ok) {
      set({ passwordPrompt: null })
      return true
    }
    if (result.error.code === 'password-required') {
      // Why: a wrong prompted password keeps the dialog open with the server's reason.
      set({
        passwordPrompt: {
          connectionId,
          error: password === undefined ? null : result.error.message
        }
      })
      return false
    }
    set((state) => ({
      passwordPrompt: null,
      sessions: {
        ...state.sessions,
        [connectionId]: { state: 'error', message: result.error.message }
      }
    }))
    return false
  },

  disconnect: async (connectionId) => {
    await window.api.database.disconnect(connectionId)
  },

  applySessionEvent: (event) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [event.connectionId]: {
          state: event.state,
          message: event.message,
          serverVersion: event.serverVersion
        }
      }
    }))
  },

  dismissPasswordPrompt: () => set({ passwordPrompt: null })
}))

export function findDatabaseConnection(connectionId: string): DatabaseConnectionSummary | null {
  return (
    useDatabaseConnectionsStore
      .getState()
      .connections.find((connection) => connection.id === connectionId) ?? null
  )
}
