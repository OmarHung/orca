import { create } from 'zustand'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  DatabaseQueryResult,
  DatabaseRowsResult,
  DatabaseTransactionState
} from '../../../../../shared/database/database-query-types'
import { DATABASE_DEFAULT_PAGE_SIZE } from '../../../../../shared/database/database-session-types'
import type { SqlStatementRange } from '../../../../../shared/database/sql-statement-splitter'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import { useDatabasePageStore } from '../database-page-store'
import type { DatabaseRunTarget } from '../database-page-tabs'
import {
  executeReconnecting,
  transactionLostMessage,
  type DatabaseRunOptions
} from './database-console-execute'
import { offsetOfStatementLine } from './database-console-statements'
import { invalidateSqlCatalog } from './sql-completion-catalog'

/** Rows kept per result in the renderer; scrolling stops loading past this. */
export const DATABASE_MAX_BUFFERED_ROWS = 100_000
const LOG_LIMIT = 200
const SCHEMA_CHANGE = /^(create|alter|drop|rename)\b/i

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
  /** The console session's transaction, as of its last statement. */
  transaction: DatabaseTransactionState
}

const EMPTY_RUN_STATE: DatabaseConsoleRunState = {
  running: false,
  results: [],
  activeResultId: OUTPUT_RESULT_ID,
  log: [],
  errorOffset: null,
  transaction: 'none'
}

type DatabaseConsoleRunStore = {
  consoles: Record<string, DatabaseConsoleRunState>
  run: (
    tab: DatabaseRunTarget,
    statements: SqlStatementRange[],
    options?: DatabaseRunOptions
  ) => Promise<void>
  fetchMore: (tab: DatabaseRunTarget, resultTabId: string) => Promise<void>
  cancel: (tab: DatabaseRunTarget) => Promise<void>
  selectResult: (tabId: string, resultId: string) => void
  /** The connection closed under these tabs; any transaction they held is gone. */
  endTransactions: (tabIds: readonly string[]) => void
  dispose: (tabId: string) => void
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

    run: async (tab, statements, options = {}) => {
      if (statements.length === 0 || getConsoleRunState(get().consoles, tab.id).running) {
        return
      }
      patch(tab.id, () => ({ running: true, results: [], errorOffset: null }), { create: true })
      try {
        if (!(await useDatabaseConnectionsStore.getState().connect(tab.connectionId))) {
          return
        }
        for (const statement of statements) {
          const inTransaction = getConsoleRunState(get().consoles, tab.id).transaction !== 'none'
          const response = await executeReconnecting(tab, statement.text, {
            ...options,
            inTransaction
          })
          const transaction = response.ok ? response.value.transaction : response.error.transaction
          if (transaction) {
            patch(tab.id, () => ({ transaction }))
          }
          // A statement like USE moved the console; the schema picker follows it.
          if (response.ok && response.value.schema) {
            useDatabasePageStore.getState().setConsoleSchema(tab.id, response.value.schema)
          }
          if (response.ok && response.value.database) {
            useDatabasePageStore.getState().setConsoleDatabase(tab.id, response.value.database)
          }
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
          if (
            response.value.results.some(
              (value) => value.kind === 'command' && SCHEMA_CHANGE.test(value.command)
            )
          ) {
            invalidateSqlCatalog(tab.connectionId)
          }
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

    endTransactions: (tabIds) => {
      for (const tabId of tabIds) {
        if (getConsoleRunState(get().consoles, tabId).transaction === 'none') {
          continue
        }
        patch(tabId, () => ({ transaction: 'none' }))
        appendLog(tabId, '', { kind: 'error', message: transactionLostMessage() })
      }
    },

    dispose: (tabId) =>
      set((state) => {
        const { [tabId]: _removed, ...rest } = state.consoles
        return { consoles: rest }
      })
  }
})
