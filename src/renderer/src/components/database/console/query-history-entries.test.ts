import { describe, expect, it } from 'vitest'
import type { DatabaseHistoryEntry } from '../../../../../shared/database/database-query-history-types'
import { filterHistory, historyPreview } from './query-history-entries'

const entry = (sql: string): DatabaseHistoryEntry => ({ sql, at: 1, outcome: 'ok', durationMs: 1 })

describe('query history entries', () => {
  it('previews a statement on one line', () => {
    expect(historyPreview('select a,\n       b\n  from t\n')).toBe('select a, b from t')
  })

  it('matches every word of the query in any order and case', () => {
    const entries = [entry('SELECT * FROM people'), entry('update orders set x = 1')]
    expect(filterHistory(entries, '  people select ').map((e) => e.sql)).toEqual([
      'SELECT * FROM people'
    ])
    expect(filterHistory(entries, 'orders people')).toEqual([])
    expect(filterHistory(entries, '')).toEqual(entries)
  })
})
