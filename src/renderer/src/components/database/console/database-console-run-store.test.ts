import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DatabaseQueryResult,
  DatabaseResult
} from '../../../../../shared/database/database-query-types'
import { splitSqlStatements } from '../../../../../shared/database/sql-statement-splitter'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import type { DatabaseConsoleTab } from '../database-page-store'
import {
  OUTPUT_RESULT_ID,
  getConsoleRunState,
  useDatabaseConsoleRunStore
} from './database-console-run-store'

const tab: DatabaseConsoleTab = {
  id: 'tab-1',
  connectionId: 'conn-0001',
  consoleId: 'console-01',
  title: 'Local'
}

const rows = (count: number, start = 0): string[][] =>
  Array.from({ length: count }, (_, index) => [String(start + index + 1)])

type ExecuteMock = ReturnType<
  typeof vi.fn<(request: { sql: string }) => Promise<DatabaseResult<DatabaseQueryResult>>>
>

function installApi(execute: ExecuteMock): void {
  vi.stubGlobal('window', {
    api: {
      database: {
        connect: vi.fn(async () => ({ ok: true, value: { serverVersion: '17' } })),
        execute,
        fetchMore: vi.fn(async () => ({
          ok: true,
          value: { rows: rows(200, 500), hasMore: false }
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
    const execute: ExecuteMock = vi.fn(async ({ sql }) =>
      sql.startsWith('update')
        ? { ok: true, value: { kind: 'command', command: 'UPDATE', rowCount: 2, durationMs: 3 } }
        : {
            ok: true,
            value: {
              kind: 'rows',
              resultId: 'r1',
              columns: [{ name: 'n', typeName: 'integer' }],
              rows: rows(500),
              hasMore: true,
              durationMs: 5
            }
          }
    )
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

  it('does not resurrect a console disposed while its statement ran', async () => {
    let finish: (value: DatabaseResult<DatabaseQueryResult>) => void = () => undefined
    const execute: ExecuteMock = vi.fn(() => new Promise((resolve) => (finish = resolve)))
    installApi(execute)
    const running = useDatabaseConsoleRunStore
      .getState()
      .run(tab, splitSqlStatements('select 1', 'postgres'))
    await vi.waitFor(() => expect(execute).toHaveBeenCalled())
    useDatabaseConsoleRunStore.getState().dispose(tab.id)
    finish({ ok: true, value: { kind: 'command', command: 'SELECT', rowCount: 1, durationMs: 1 } })
    await running
    expect(useDatabaseConsoleRunStore.getState().consoles[tab.id]).toBeUndefined()
  })
})
