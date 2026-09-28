import { describe, expect, it, vi } from 'vitest'
import {
  DATABASE_LONG_VALUE_READ_MAX_CHARS,
  DATABASE_LONG_VALUE_READ_MAX_SLICES,
  type DatabaseCell,
  type DatabaseLongValueSlice
} from '../../../../../shared/database/database-query-types'
import { gridExportSlice, toCsv, toInsertSql, toJson, toTsv } from './database-grid-export'
import {
  planLongValueReads,
  withWholeValues,
  type ReadLongValues
} from './database-grid-long-values'

const DECIMAL = '12345678901234567890.123456789012345678'
const PAST_SAFE = '99999999999999999999999999999999999999'
const TEXT = `${'x'.repeat(12_000)}"3"`
const BINARY = `0x${'AB'.repeat(6_000)}`

const columns = [
  { name: 'id', typeName: 'int' },
  { name: 'amount', typeName: 'decimal(38,18)' },
  { name: 'big', typeName: 'numeric(38,0)' },
  { name: 'body', typeName: 'nvarchar(max)' },
  { name: 'bin', typeName: 'varbinary(max)' }
]
const preview = (text: string): DatabaseCell => ({
  preview: text.slice(0, 10_000),
  length: text.length
})
// Rows 0 and 1 came in the first page, row 2 in the second.
const rows: DatabaseCell[][] = [
  ['1', '0.000000000000000001', '1', 'short', '0x00'],
  ['2', DECIMAL, PAST_SAFE, preview(TEXT), null],
  ['3', `-${DECIMAL}`, PAST_SAFE, preview(TEXT), preview(BINARY)]
]

/** A worker holding the whole text of rows 1 and 2's long values, read by the slice. */
function worker(held: Record<string, string> = { '1:3': TEXT, '2:3': TEXT, '2:4': BINARY }) {
  const reads: DatabaseLongValueSlice[][] = []
  const read: ReadLongValues = async (slices) => {
    reads.push(slices)
    return {
      ok: true,
      value: {
        values: slices.map(
          (slice) => held[`${slice.row}:${slice.column}`]?.slice(slice.start, slice.end) ?? null
        )
      }
    }
  }
  return { read, reads }
}

// The grid sorted descending by id, and the user selected two rows by four columns.
const selected = gridExportSlice(columns, rows, [2, 1, 0], { top: 0, bottom: 1, left: 1, right: 4 })

describe('planLongValueReads', () => {
  it('splits a value longer than one read across reads, each within the caps', () => {
    const reads = planLongValueReads([
      { row: 0, column: 1, length: DATABASE_LONG_VALUE_READ_MAX_CHARS + 10 },
      { row: 1, column: 1, length: 5 }
    ])
    expect(reads).toEqual([
      [{ row: 0, column: 1, start: 0, end: DATABASE_LONG_VALUE_READ_MAX_CHARS }],
      [
        {
          row: 0,
          column: 1,
          start: DATABASE_LONG_VALUE_READ_MAX_CHARS,
          end: DATABASE_LONG_VALUE_READ_MAX_CHARS + 10
        },
        { row: 1, column: 1, start: 0, end: 5 }
      ]
    ])
    const many = Array.from({ length: DATABASE_LONG_VALUE_READ_MAX_SLICES + 1 }, (_, row) => ({
      row,
      column: 0,
      length: 12_000
    }))
    const planned = planLongValueReads(many)
    for (const read of planned) {
      expect(read.length).toBeLessThanOrEqual(DATABASE_LONG_VALUE_READ_MAX_SLICES)
      expect(read.reduce((total, part) => total + part.end - part.start, 0)).toBeLessThanOrEqual(
        DATABASE_LONG_VALUE_READ_MAX_CHARS
      )
    }
    // Every value is covered once, in order, with no gap between the parts of a split one.
    const covered = new Map<number, number>()
    for (const part of planned.flat()) {
      expect(part.start).toBe(covered.get(part.row) ?? 0)
      covered.set(part.row, part.end)
    }
    expect([...covered.values()]).toEqual(many.map(() => 12_000))
  })
})

describe('withWholeValues', () => {
  it('reads each preview of a selected rectangle by its row in the result, across pages', async () => {
    expect(selected.rowNumbers).toEqual([2, 1])
    expect(selected.firstColumn).toBe(1)
    const { read, reads } = worker()
    const whole = await withWholeValues(selected, read, Number.MAX_SAFE_INTEGER)
    expect(reads).toEqual([
      [
        { row: 2, column: 3, start: 0, end: TEXT.length },
        { row: 2, column: 4, start: 0, end: BINARY.length },
        { row: 1, column: 3, start: 0, end: TEXT.length }
      ]
    ])
    expect(whole).toEqual({
      ok: true,
      input: {
        columns: columns.slice(1),
        rows: [
          [`-${DECIMAL}`, PAST_SAFE, TEXT, BINARY],
          [DECIMAL, PAST_SAFE, TEXT, null]
        ]
      }
    })
  })

  it('writes CSV, TSV, JSON and INSERT with whole values and exact numbers', async () => {
    const whole = await withWholeValues(selected, worker().read, Number.MAX_SAFE_INTEGER)
    if (!whole.ok) {
      throw new Error('expected whole values')
    }
    const quotedText = `"${TEXT.replaceAll('"', '""')}"`
    expect(toCsv(whole.input).split('\n')).toEqual([
      'amount,big,body,bin',
      `-${DECIMAL},${PAST_SAFE},${quotedText},${BINARY}`,
      `${DECIMAL},${PAST_SAFE},${quotedText},`
    ])
    expect(toTsv(whole.input, { header: false })).toContain(`\t${BINARY}\n`)
    expect(JSON.parse(toJson(whole.input))).toEqual([
      { amount: `-${DECIMAL}`, big: PAST_SAFE, body: TEXT, bin: BINARY },
      { amount: DECIMAL, big: PAST_SAFE, body: TEXT, bin: null }
    ])
    const insert = toInsertSql(whole.input, { table: 't', driver: 'sqlserver' }).split('\n')
    expect(insert[0]).toBe(
      `INSERT INTO t (amount, big, body, bin) VALUES (-${DECIMAL}, ${PAST_SAFE}, '${TEXT}', '${BINARY}');`
    )
  })

  it('writes nothing from a preview: the formats refuse one that was never read', () => {
    expect(() => toCsv(selected)).toThrow(/preview/)
    expect(() => toJson(selected)).toThrow(/preview/)
    expect(() => toInsertSql(selected, { table: 't', driver: 'mysql' })).toThrow(/preview/)
  })

  it('reports values the worker no longer holds instead of using their previews', async () => {
    const { read } = worker({ '2:3': TEXT })
    expect(await withWholeValues(selected, read, Number.MAX_SAFE_INTEGER)).toEqual({
      ok: false,
      failure: { kind: 'not-kept', count: 2 }
    })
    // A value that comes back shorter than its length is not whole either.
    const short = worker({ '1:3': TEXT, '2:3': TEXT.slice(1), '2:4': BINARY })
    expect(await withWholeValues(selected, short.read, Number.MAX_SAFE_INTEGER)).toEqual({
      ok: false,
      failure: { kind: 'not-kept', count: 1 }
    })
  })

  it('stops before reading when the values alone pass the output’s limit, or a read fails', async () => {
    const { read, reads } = worker()
    expect(await withWholeValues(selected, read, 30_000)).toEqual({
      ok: false,
      failure: { kind: 'too-large' }
    })
    expect(reads).toEqual([])
    const failing: ReadLongValues = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Not connected' }
    }))
    expect(await withWholeValues(selected, failing, Number.MAX_SAFE_INTEGER)).toEqual({
      ok: false,
      failure: { kind: 'read-failed', message: 'Not connected' }
    })
  })

  it('reads nothing when every value is already whole', async () => {
    const { read, reads } = worker()
    const plain = gridExportSlice(columns, rows, [0, 1, 2], {
      top: 0,
      bottom: 0,
      left: 0,
      right: 4
    })
    expect(await withWholeValues(plain, read, 10)).toEqual({
      ok: true,
      input: { columns, rows: [rows[0]] }
    })
    expect(reads).toEqual([])
  })
})
