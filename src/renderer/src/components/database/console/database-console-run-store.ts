import { create } from 'zustand'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  DatabaseExecuteResult,
  DatabaseQueryResult,
  DatabaseResult,
  DatabaseRowsResult
} from '../../../../../shared/database/database-query-types'
import { DATABASE_DEFAULT_PAGE_SIZE } from '../../../../../shared/database/database-session-types'
import type { SqlStatementRange } from '../../../../../shared/database/sql-statement-splitter'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import type { DatabaseConsoleTab } from '../database-page-store'
import { offsetOfStatementLine } from './database-console-statements'

/** Rows kept per result in the renderer; scrolling stops loading past this. */
export const DATABASE_MAX_BUFFERED_ROWS = 100_000
const LOG_LIMIT = 200

export const OUTPUT_RESULT_ID = 'output'

export type DatabaseResultTab = {
  id: string
  statement: string
  result: DatabaseRowsResult
  loadingMore: boolean
  loadError: string | null
}

export type DatabaseConsoleLogOutcome =
  | { kind: 'rows'; rowCount: number; hasMore: boolean; durationMs: number }
  | { kind: 'command'; command: string; rowCount: number | null; durationMs: number }
  | { kind: 'error'; message: string; detail?: string; hint?: string }
  | { kind: 'cancelled' }

export type DatabaseConsoleLogEntry = {
  id: string
  at: number
  statement: string
  outcome: DatabaseConsoleLogOutcome
}

export type DatabaseConsoleRunState = {
  running: boolean
  results: DatabaseResultTab[]
  activeResultId: string
  log: DatabaseConsoleLogEntry[]
  /** Offset into the console text of the last error, for the editor marker. */
  errorOffset: number | null
}

const EMPTY_RUN_STATE: DatabaseConsoleRunState = {
  running: false,
  results: [],
  activeResultId: OUTPUT_RESULT_ID,
  log: [],
  errorOffset: null
}

type DatabaseConsoleRunStore = {
  consoles: Record<string, DatabaseConsoleRunState>
  run: (tab: DatabaseConsoleTab, statements: SqlStatementRange[]) => Promise<void>
  fetchMore: (tab: DatabaseConsoleTab, resultTabId: string) => Promise<void>
  cancel: (tab: DatabaseConsoleTab) => Promise<void>
  selectResult: (tabId: string, resultId: string) => void
  dispose: (tabId: string) => void
}

async function execute(
  tab: DatabaseConsoleTab,
  sql: string
): Promise<DatabaseResult<DatabaseExecuteResult>> {
  return asDatabaseResult(
    await window.api.database.execute({
      connectionId: tab.connectionId,
      consoleId: tab.consoleId,
      sql,
      pageSize: DATABASE_DEFAULT_PAGE_SIZE
    })
  )
}

/** Retries once after reconnecting when main dropped the session (e.g. a restarted SQLite worker). */
async function executeReconnecting(
  tab: DatabaseConsoleTab,
  sql: string
): Promise<DatabaseResult<DatabaseExecuteResult>> {
  const response = await execute(tab, sql)
  if (response.ok || response.error.code !== 'not-connected') {
    return response
  }
  const connections = useDatabaseConnectionsStore.getState()
  connections.applySessionEvent({
    kind: 'session-state',
    connectionId: tab.connectionId,
    state: 'disconnected'
  })
  return (await connections.connect(tab.connectionId)) ? execute(tab, sql) : response
}

export function getConsoleRunState(
  consoles: Record<string, DatabaseConsoleRunState>,
  tabId: string
): DatabaseConsoleRunState {
  return consoles[tabId] ?? EMPTY_RUN_STATE
}

export const useDatabaseConsoleRunStore = create<DatabaseConsoleRunStore>((set, get) => {
  const patch = (
    tabId: string,
    update: (current: DatabaseConsoleRunState) => Partial<DatabaseConsoleRunState>,
    options: { create?: boolean } = {}
  ): void =>
    set((state) => {
      // Why: a run can finish after its tab closed; don't resurrect the disposed state.
      if (!options.create && !state.consoles[tabId]) {
        return state
      }
      const current = getConsoleRunState(state.consoles, tabId)
      return { consoles: { ...state.consoles, [tabId]: { ...current, ...update(current) } } }
    })

  const appendLog = (tabId: string, statement: string, outcome: DatabaseConsoleLogOutcome): void =>
    patch(tabId, (current) => ({
      log: [...current.log, { id: createBrowserUuid(), at: Date.now(), statement, outcome }].slice(
        -LOG_LIMIT
      )
    }))

  const patchResult = (
    tabId: string,
    resultTabId: string,
    update: (result: DatabaseResultTab) => Partial<DatabaseResultTab>
  ): void =>
    patch(tabId, (current) => ({
      results: current.results.map((result) =>
        result.id === resultTabId ? { ...result, ...update(result) } : result
      )
    }))

  /** Logs every result of one statement and opens a result tab per row set. */
  const recordResults = (
    tabId: string,
    statement: string,
    results: readonly DatabaseQueryResult[],
    options: { focus: boolean }
  ): void => {
    for (const value of results) {
      if (value.kind === 'command') {
        appendLog(tabId, statement, value)
        continue
      }
      const resultTab: DatabaseResultTab = {
        id: createBrowserUuid(),
        statement,
        result: value,
        loadingMore: false,
        loadError: null
      }
      patch(tabId, (current) => ({
        results: [...current.results, resultTab],
        activeResultId: options.focus ? resultTab.id : current.activeResultId
      }))
      appendLog(tabId, statement, {
        kind: 'rows',
        rowCount: value.rows.length,
        hasMore: value.hasMore,
        durationMs: value.durationMs
      })
    }
  }

  return {
    consoles: {},

    run: async (tab, statements) => {
      if (statements.length === 0 || getConsoleRunState(get().consoles, tab.id).running) {
        return
      }
      patch(tab.id, () => ({ running: true, results: [], errorOffset: null }), { create: true })
      try {
        if (!(await useDatabaseConnectionsStore.getState().connect(tab.connectionId))) {
          return
        }
        for (const statement of statements) {
          const response = await executeReconnecting(tab, statement.text)
          if (!response.ok) {
            const { error } = response
            appendLog(
              tab.id,
              statement.text,
              error.code === 'cancelled'
                ? { kind: 'cancelled' }
                : { kind: 'error', message: error.message, detail: error.detail, hint: error.hint }
            )
            patch(tab.id, () => ({
              activeResultId: OUTPUT_RESULT_ID,
              errorOffset: error.position
                ? statement.start + error.position - 1
                : error.line
                  ? offsetOfStatementLine(statement, error.line)
                  : null
            }))
            return
          }
          recordResults(tab.id, statement.text, response.value.results, { focus: true })
        }
      } finally {
        patch(tab.id, () => ({ running: false }))
      }
    },

    fetchMore: async (tab, resultTabId) => {
      const target = getConsoleRunState(get().consoles, tab.id).results.find(
        (result) => result.id === resultTabId
      )
      if (
        !target ||
        target.loadingMore ||
        !target.result.hasMore ||
        target.result.rows.length >= DATABASE_MAX_BUFFERED_ROWS
      ) {
        return
      }
      patchResult(tab.id, resultTabId, () => ({ loadingMore: true, loadError: null }))
      const response = asDatabaseResult(
        await window.api.database.fetchMore({
          connectionId: tab.connectionId,
          consoleId: tab.consoleId,
          resultId: target.result.resultId,
          pageSize: DATABASE_DEFAULT_PAGE_SIZE
        })
      )
      patchResult(tab.id, resultTabId, (current) =>
        response.ok
          ? {
              loadingMore: false,
              result: {
                ...current.result,
                rows: [...current.result.rows, ...response.value.rows],
                hasMore: response.value.hasMore
              }
            }
          : {
              loadingMore: false,
              loadError: response.error.message,
              result: { ...current.result, hasMore: false }
            }
      )
      const following = response.ok ? (response.value.followingResults ?? []) : []
      // Later result sets of the batch arrive once the paged one is fully read.
      recordResults(tab.id, target.statement, following, { focus: false })
    },

    cancel: async (tab) => {
      await window.api.database.cancel({ connectionId: tab.connectionId, consoleId: tab.consoleId })
    },

    selectResult: (tabId, resultId) =>
      patch(tabId, () => ({ activeResultId: resultId }), { create: true }),

    dispose: (tabId) =>
      set((state) => {
        const { [tabId]: _removed, ...rest } = state.consoles
        return { consoles: rest }
      })
  }
})
