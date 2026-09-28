import { describe, expect, it } from 'vitest'
import {
  DATABASE_LONG_VALUE_READ_MAX_CHARS,
  DATABASE_LONG_VALUE_READ_MAX_SLICES,
  type DatabaseCell,
  type DatabaseRowsResult
} from '../../../shared/database/database-query-types'
import { DATABASE_CELL_PREVIEW_MAX_CHARS, LongValueStore } from './database-long-values'

const long = (char: string, length = 12_000): string => char.repeat(length)

function rowsResult(
  resultId: string,
  rows: DatabaseCell[][],
  hasMore: boolean
): DatabaseRowsResult {
  return {
    kind: 'rows',
    resultId,
    columns: [
      { name: 'id', typeName: 'int' },
      { name: 'body', typeName: 'text' }
    ],
    rows,
    hasMore,
    durationMs: 1
  }
}

function onlyRows(store: LongValueStore, consoleId: string, result: DatabaseRowsResult) {
  const [first] = store.previewExecute(consoleId, { results: [result] }).results
  return first?.kind === 'rows' ? first.rows : []
}

/** All of the value in `row`'s second column, whatever its length. */
const whole = (row: number) => ({ row, column: 1, start: 0, end: 20_000 })

describe('LongValueStore', () => {
  it('ships long values as previews and keeps their full text by row and column', () => {
    const store = new LongValueStore()
    const rows = onlyRows(
      store,
      'c1',
      rowsResult(
        'r1',
        [
          ['1', long('a')],
          ['2', 'short']
        ],
        false
      )
    )
    expect(rows).toEqual([
      ['1', { preview: long('a', DATABASE_CELL_PREVIEW_MAX_CHARS), length: 12_000 }],
      ['2', 'short']
    ])
    expect(store.read('c1', 'r1', [whole(0), { ...whole(0), start: 11_998, end: 12_005 }])).toEqual(
      [long('a'), 'aa']
    )
    // A value that fit in its row was never cut, so there is nothing kept to read.
    expect(store.read('c1', 'r1', [{ row: 1, column: 1, start: 0, end: 5 }])).toEqual([null])
  })

  it('numbers rows from the result’s first across pages and following result sets', () => {
    const store = new LongValueStore()
    onlyRows(
      store,
      'c1',
      rowsResult(
        'paged',
        [
          ['1', 'x'],
          ['2', long('b')]
        ],
        true
      )
    )
    const page = store.previewPage('c1', 'paged', {
      rows: [
        ['3', 'y'],
        ['4', long('c')]
      ],
      hasMore: false,
      followingResults: [rowsResult('next', [['9', long('d')]], false)]
    })
    expect(page.rows[1]?.[1]).toEqual({ preview: long('c', 10_000), length: 12_000 })
    expect(page.followingResults?.[0]).toMatchObject({ rows: [['9', { length: 12_000 }]] })
    expect(store.read('c1', 'paged', [whole(1), whole(3)])).toEqual([long('b'), long('c')])
    expect(store.read('c1', 'next', [whole(0)])).toEqual([long('d')])
  })

  it('makes room by dropping older results, never for a value that can’t fit anyway', () => {
    const store = new LongValueStore(30_000)
    onlyRows(store, 'c1', rowsResult('old', [['1', long('a')]], false))
    onlyRows(store, 'c1', rowsResult('mid', [['1', long('b')]], false))
    onlyRows(store, 'c1', rowsResult('new', [['1', long('c')]], false))
    expect(store.read('c1', 'old', [whole(0)])).toEqual([null])
    expect(store.read('c1', 'mid', [whole(0)])).toEqual([long('b')])
    // Too long for the budget on its own: shipped as a preview, kept nowhere, evicting nothing.
    const rows = onlyRows(store, 'c1', rowsResult('huge', [['1', long('z', 40_000)]], false))
    expect(rows[0]?.[1]).toEqual({ preview: long('z', 10_000), length: 40_000 })
    expect(store.read('c1', 'huge', [whole(0)])).toEqual([null])
    expect(store.read('c1', 'new', [whole(0)])).toEqual([long('c')])
    expect(store.keptChars).toBe(24_000)
  })

  it('keeps a result’s first values when the rest of it would pass the budget', () => {
    const store = new LongValueStore(30_000)
    onlyRows(
      store,
      'c1',
      rowsResult(
        'r',
        [
          ['1', long('a')],
          ['2', long('b')],
          ['3', long('c')]
        ],
        false
      )
    )
    expect(store.read('c1', 'r', [whole(0), whole(1), whole(2)])).toEqual([
      long('a'),
      long('b'),
      null
    ])
  })

  it('answers only bounded reads, and only for the console that ran the result', () => {
    const store = new LongValueStore()
    onlyRows(store, 'c1', rowsResult('r', [['1', long('a')]], false))
    const tooLong = { row: 0, column: 1, start: 0, end: DATABASE_LONG_VALUE_READ_MAX_CHARS + 1 }
    expect(() => store.read('c1', 'r', [tooLong])).toThrow(/at once/)
    const many = Array.from({ length: DATABASE_LONG_VALUE_READ_MAX_SLICES + 1 }, () => ({
      row: 0,
      column: 1,
      start: 0,
      end: 1
    }))
    expect(() => store.read('c1', 'r', many)).toThrow(/at once/)
    expect(store.read('c2', 'r', [whole(0)])).toEqual([null])
    store.dropConsole('c1')
    expect(store.read('c1', 'r', [whole(0)])).toEqual([null])
    expect(store.keptChars).toBe(0)
  })
})
