import {
  DATABASE_LONG_VALUE_READ_MAX_CHARS,
  DATABASE_LONG_VALUE_READ_MAX_SLICES,
  isDatabaseTruncatedCell,
  type DatabaseCell,
  type DatabaseLongValues,
  type DatabaseLongValueSlice,
  type DatabaseResult
} from '../../../../../shared/database/database-query-types'
import type { GridExportInput, GridSlice } from './database-grid-export'

/** The result a grid's rows came from; its worker holds the values shipped as previews. */
export type GridResultSource = { connectionId: string; consoleId: string; resultId: string }

export type ReadLongValues = (
  slices: DatabaseLongValueSlice[]
) => Promise<DatabaseResult<DatabaseLongValues>>

export type WholeValuesFailure =
  | { kind: 'not-kept'; count: number }
  | { kind: 'too-large' }
  | { kind: 'read-failed'; message: string }

type LongCell = {
  rowIndex: number
  columnIndex: number
  row: number
  column: number
  length: number
}

/** Reads covering every long cell, each within the per-read caps; a long value spans reads. */
export function planLongValueReads(
  cells: readonly { row: number; column: number; length: number }[]
): DatabaseLongValueSlice[][] {
  const reads: DatabaseLongValueSlice[][] = []
  let current: DatabaseLongValueSlice[] = []
  let chars = 0
  for (const cell of cells) {
    for (let start = 0; start < cell.length;) {
      if (
        chars === DATABASE_LONG_VALUE_READ_MAX_CHARS ||
        current.length === DATABASE_LONG_VALUE_READ_MAX_SLICES
      ) {
        reads.push(current)
        current = []
        chars = 0
      }
      const end = Math.min(cell.length, start + DATABASE_LONG_VALUE_READ_MAX_CHARS - chars)
      current.push({ row: cell.row, column: cell.column, start, end })
      chars += end - start
      start = end
    }
  }
  return current.length > 0 ? [...reads, current] : reads
}

function longCells(slice: GridSlice): LongCell[] {
  return slice.rows.flatMap((row, rowIndex) =>
    row.flatMap((cell, columnIndex) =>
      isDatabaseTruncatedCell(cell)
        ? [
            {
              rowIndex,
              columnIndex,
              row: slice.rowNumbers[rowIndex] ?? -1,
              column: slice.firstColumn + columnIndex,
              length: cell.length
            }
          ]
        : []
    )
  )
}

/**
 * The slice with every preview replaced by its whole value, read from the result's worker in
 * bounded steps; or why it can't be, so nothing is ever written from a preview. `maxChars`
 * is what the output may hold: past it, reading would be wasted.
 */
export async function withWholeValues(
  slice: GridSlice,
  read: ReadLongValues,
  maxChars: number
): Promise<{ ok: true; input: GridExportInput } | { ok: false; failure: WholeValuesFailure }> {
  const cells = longCells(slice)
  if (cells.length === 0) {
    return { ok: true, input: { columns: slice.columns, rows: slice.rows } }
  }
  if (cells.reduce((total, cell) => total + cell.length, 0) > maxChars) {
    return { ok: false, failure: { kind: 'too-large' } }
  }
  const parts = new Map<string, string[]>()
  const missing = new Set<string>()
  for (const slices of planLongValueReads(cells)) {
    const response = await read(slices)
    if (!response.ok) {
      return { ok: false, failure: { kind: 'read-failed', message: response.error.message } }
    }
    slices.forEach((part, index) => {
      const key = `${part.row}:${part.column}`
      const text = response.value.values[index]
      if (typeof text === 'string') {
        parts.set(key, [...(parts.get(key) ?? []), text])
      } else {
        missing.add(key)
      }
    })
  }
  const whole = new Map<string, string>()
  for (const cell of cells) {
    const text = (parts.get(`${cell.row}:${cell.column}`) ?? []).join('')
    // Why check the length: a value only partly read must not pass for the whole one.
    if (text.length === cell.length) {
      whole.set(`${cell.rowIndex}:${cell.columnIndex}`, text)
    } else {
      missing.add(`${cell.row}:${cell.column}`)
    }
  }
  if (missing.size > 0) {
    return { ok: false, failure: { kind: 'not-kept', count: missing.size } }
  }
  const rows = slice.rows.map((row, rowIndex) =>
    row.map((cell, columnIndex): DatabaseCell => whole.get(`${rowIndex}:${columnIndex}`) ?? cell)
  )
  return { ok: true, input: { columns: slice.columns, rows } }
}
