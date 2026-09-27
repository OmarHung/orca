import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DATABASE_HISTORY_LIMIT,
  DATABASE_HISTORY_MAX_SQL_CHARS,
  type DatabaseHistoryEntry
} from '../../shared/database/database-query-history-types'
import { DatabaseQueryHistory } from './database-query-history'

const CONNECTION = 'conn-1234'

function entry(sql: string, at = 1): DatabaseHistoryEntry {
  return { sql, at, outcome: 'ok', durationMs: 3 }
}

describe('DatabaseQueryHistory', () => {
  let dir: string
  let history: DatabaseQueryHistory

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-db-history-'))
    history = new DatabaseQueryHistory(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists statements newest first and moves a re-run statement to the top', async () => {
    await history.record(CONNECTION, entry('select 1', 1))
    await history.record(CONNECTION, entry('  select 2\n', 2))
    await history.record(CONNECTION, { ...entry('select 1', 3), outcome: 'error' })
    expect(await history.list(CONNECTION)).toEqual([
      { sql: 'select 1', at: 3, outcome: 'error', durationMs: 3 },
      { sql: 'select 2', at: 2, outcome: 'ok', durationMs: 3 }
    ])
    expect(await history.list('conn-other')).toEqual([])
  })

  it('keeps concurrent records from different consoles', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => history.record(CONNECTION, entry(`select ${index}`)))
    )
    expect(await history.list(CONNECTION)).toHaveLength(20)
  })

  it('drops the oldest past the limit and skips blank or oversized statements', async () => {
    for (let index = 0; index < DATABASE_HISTORY_LIMIT + 5; index += 1) {
      await history.record(CONNECTION, entry(`select ${index}`, index))
    }
    await history.record(CONNECTION, entry('   '))
    await history.record(CONNECTION, entry(`-- ${'x'.repeat(DATABASE_HISTORY_MAX_SQL_CHARS)}`))
    const entries = await history.list(CONNECTION)
    expect(entries).toHaveLength(DATABASE_HISTORY_LIMIT)
    expect(entries[0]?.sql).toBe(`select ${DATABASE_HISTORY_LIMIT + 4}`)
    expect(entries.at(-1)?.sql).toBe('select 5')
  })

  it('caps the total size so each run rewrites a bounded file', async () => {
    const big = 'x'.repeat(DATABASE_HISTORY_MAX_SQL_CHARS - 10)
    for (let index = 0; index < 40; index += 1) {
      await history.record(CONNECTION, entry(`-- ${index}\n${big}`))
    }
    const entries = await history.list(CONNECTION)
    expect(entries.length).toBeLessThan(40)
    expect(entries[0]?.sql.startsWith('-- 39\n')).toBe(true)
    expect(statSync(join(dir, `${CONNECTION}.json`)).size).toBeLessThan(2.1 * 1024 * 1024)
  })

  it('writes an owner-only file and ignores a damaged one', async () => {
    await history.record(CONNECTION, entry('select 1'))
    const file = join(dir, `${CONNECTION}.json`)
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
    writeFileSync(file, '{ not json')
    expect(await history.list(CONNECTION)).toEqual([])
    await history.record(CONNECTION, entry('select 2'))
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(1)
  })

  it('clears a connection’s history', async () => {
    await history.record(CONNECTION, entry('select 1'))
    await history.clear(CONNECTION)
    expect(await history.list(CONNECTION)).toEqual([])
  })
})
