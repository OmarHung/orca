import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DatabaseExecuteResult,
  DatabaseQueryResult,
  DatabaseResult,
  DatabaseRowsPage
} from '../../../../../shared/database/database-query-types'
import { splitSqlStatements } from '../../../../../shared/database/sql-statement-splitter'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import type { DatabaseRunTarget } from '../database-page-tabs'
import {
  OUTPUT_RESULT_ID,
  getConsoleRunState,
  useDatabaseConsoleRunStore
} from './database-console-run-store'

const tab: DatabaseRunTarget = {
  id: 'tab-1',
  connectionId: 'conn-0001',
  consoleId: 'console-01'
}

const rows = (count: number, start = 0): string[][] =>
  Array.from({ length: count }, (_, index) => [String(start + index + 1)])

const rowsResult = (resultId: string, count: number, hasMore: boolean): DatabaseQueryResult => ({
  kind: 'rows',
  resultId,
  columns: [{ name: 'n', typeName: 'integer' }],
  rows: rows(count),
  hasMore,
  durationMs: 5
})

type ExecuteMock = ReturnType<
  typeof vi.fn<
    (request: {
      sql: string
      recordHistory?: boolean
    }) => Promise<DatabaseResult<DatabaseExecuteResult>>
  >
>

function installApi(execute: ExecuteMock, fetched?: DatabaseRowsPage): void {
  vi.stubGlobal('window', {
    api: {
      database: {
        connect: vi.fn(async () => ({ ok: true, value: { serverVersion: '17' } })),
        execute,
        fetchMore: vi.fn(async () => ({
          ok: true,
          value: fetched ?? { rows: rows(200, 500), hasMore: false }
        })),
        cancel: vi.fn(async () => true)
      }
    }
  })
}

function state() {
  return getConsoleRunState(useDatabaseConsoleRunStore.getState().consoles, tab.id)
}

describe('database console run store', () => {
  beforeEach(() => {
    useDatabaseConsoleRunStore.setState({ consoles: {} })
    useDatabaseConnectionsStore.setState({ sessions: {}, passwordPrompt: null })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('runs statements in order, opening a result tab per row set', async () => {
    const execute: ExecuteMock = vi.fn(async ({ sql }) => ({
      ok: true,
      value: {
        results: sql.startsWith('update')
          ? [{ kind: 'command', command: 'UPDATE', rowCount: 2, durationMs: 3 }]
          : [rowsResult('r1', 500, true)]
      }
    }))
    installApi(execute)
    const sql = 'update t set a = 1;\nselect n from t;'
    await useDatabaseConsoleRunStore.getState().run(tab, splitSqlStatements(sql, 'postgres'))

    expect(execute.mock.calls.map(([request]) => request.sql)).toEqual([
      'update t set a = 1',
      'select n from t'
    ])
    expect(state().results).toHaveLength(1)
    expect(state().activeResultId).toBe(state().results[0]?.id)
    expect(state().log.map((entry) => entry.outcome.kind)).toEqual(['command', 'rows'])
    expect(state().running).toBe(false)

    await useDatabaseConsoleRunStore.getState().fetchMore(tab, state().results[0]!.id)
    expect(state().results[0]?.result.rows).toHaveLength(700)
    expect(state().results[0]?.result.hasMore).toBe(false)
  })

  it('asks main to record history only for runs that opt in', async () => {
    const execute: ExecuteMock = vi.fn(async () => ({ ok: true, value: { results: [] } }))
    installApi(execute)
    const statements = splitSqlStatements('select 1', 'postgres')
    await useDatabaseConsoleRunStore.getState().run(tab, statements, { recordHistory: true })
    await useDatabaseConsoleRunStore.getState().run(tab, statements)
    expect(execute.mock.calls.map(([request]) => request.recordHistory)).toEqual([true, undefined])
  })

  it('opens a tab for every result set of a batch, and for sets that follow a paged one', async () => {
    const execute: ExecuteMock = vi.fn(async () => ({
      ok: true,
      value: { results: [rowsResult('r1', 1, false), rowsResult('r2', 500, true)] }
    }))
    installApi(execute, {
      rows: rows(3),
      hasMore: false,
      followingResults: [rowsResult('r3', 1, false)]
    })
    await useDatabaseConsoleRunStore
      .getState()
      .run(tab, splitSqlStatements('select 1', 'sqlserver'))
    expect(state().results).toHaveLength(2)
    const paged = state().results[1]!
    expect(state().activeResultId).toBe(paged.id)

    await useDatabaseConsoleRunStore.getState().fetchMore(tab, paged.id)
    expect(state().results.map((result) => result.result.resultId)).toEqual(['r1', 'r2', 'r3'])
    // A set that arrives while paging doesn't steal focus from the grid being read.
    expect(state().activeResultId).toBe(paged.id)
  })

  it('stops at the first error and points the marker at the server position', async () => {
    const execute: ExecuteMock = vi.fn(async () => ({
      ok: false,
      error: { message: 'relation "x" does not exist', position: 15 }
    }))
    installApi(execute)
    const sql = 'select 1;\nselect * from x;\nselect 3;'
    const statements = splitSqlStatements(sql, 'postgres').slice(1)
    await useDatabaseConsoleRunStore.getState().run(tab, statements)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(state().activeResultId).toBe(OUTPUT_RESULT_ID)
    expect(sql.slice(state().errorOffset!)).toMatch(/^x;/)
  })

  it('points the marker at the reported line when the server gives lines', async () => {
    const execute: ExecuteMock = vi.fn(async () => ({
      ok: false,
      error: { message: "Invalid object name 'x'.", line: 2 }
    }))
    installApi(execute)
    const sql = 'select 1\n  select * from x'
    await useDatabaseConsoleRunStore.getState().run(tab, splitSqlStatements(sql, 'sqlserver'))
    expect(sql.slice(state().errorOffset!)).toBe('select * from x')
  })

  it('does not resurrect a console disposed while its statement ran', async () => {
    let finish: (value: DatabaseResult<DatabaseExecuteResult>) => void = () => undefined
    const execute: ExecuteMock = vi.fn(() => new Promise((resolve) => (finish = resolve)))
    installApi(execute)
    const running = useDatabaseConsoleRunStore
      .getState()
      .run(tab, splitSqlStatements('select 1', 'postgres'))
    await vi.waitFor(() => expect(execute).toHaveBeenCalled())
    useDatabaseConsoleRunStore.getState().dispose(tab.id)
    finish({
      ok: true,
      value: { results: [{ kind: 'command', command: 'SELECT', rowCount: 1, durationMs: 1 }] }
    })
    await running
    expect(useDatabaseConsoleRunStore.getState().consoles[tab.id]).toBeUndefined()
  })
})
