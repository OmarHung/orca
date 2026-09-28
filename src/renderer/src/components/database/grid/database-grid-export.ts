import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import {
  isDatabaseTruncatedCell,
  type DatabaseCell,
  type DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import { quoteSqlName } from '../../../../../shared/database/sql-identifiers'
import { sqlLiteral } from '../../../../../shared/database/sql-literals'
import { isNumericColumnType } from './database-grid-columns'
import type { GridBounds } from './database-grid-selection'

export type GridExportInput = { columns: DatabaseColumn[]; rows: DatabaseCell[][] }

/** A grid slice and where each of its cells sits in the result. */
export type GridSlice = GridExportInput & {
  /** Each slice row's number in the result, counted from its first row. */
  rowNumbers: number[]
  /** The result column of the slice's first column. */
  firstColumn: number
}

/** The selected rectangle (or everything) in display order, as plain columns and rows. */
export function gridExportSlice(
  columns: readonly DatabaseColumn[],
  rows: readonly DatabaseCell[][],
  displayOrder: readonly number[],
  bounds: GridBounds | null
): GridSlice {
  const left = bounds?.left ?? 0
  const right = bounds?.right ?? columns.length - 1
  const top = bounds?.top ?? 0
  const bottom = bounds?.bottom ?? displayOrder.length - 1
  const rowNumbers = displayOrder.slice(top, bottom + 1)
  return {
    columns: columns.slice(left, right + 1),
    rows: rowNumbers.map((source) => (rows[source] ?? []).slice(left, right + 1)),
    rowNumbers,
    firstColumn: left
  }
}

// Why throw: a preview written as if it were the value is the silent loss this guards against.
function wholeText(cell: DatabaseCell): string | null {
  if (isDatabaseTruncatedCell(cell)) {
    throw new Error('A value shipped as a preview reached the export unread.')
  }
  return cell
}

function delimited(input: GridExportInput, separator: string, header: boolean): string {
  const needsQuotes = new RegExp(`[${separator === '\t' ? '\\t' : separator}"\\r\\n]`)
  const field = (text: string | null): string => {
    const value = text ?? ''
    return needsQuotes.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  }
  const lines = input.rows.map((row) => row.map((cell) => field(wholeText(cell))).join(separator))
  return (
    header ? [input.columns.map((column) => field(column.name)).join(separator), ...lines] : lines
  ).join('\n')
}

/** Tab-separated, quoted the way spreadsheets expect, so a paste lands in the same cells. */
export function toTsv(input: GridExportInput, options: { header: boolean }): string {
  return delimited(input, '\t', options.header)
}

export function toCsv(input: GridExportInput): string {
  return delimited(input, ',', true)
}

function uniqueKeys(columns: readonly DatabaseColumn[]): string[] {
  const seen = new Map<string, number>()
  return columns.map((column) => {
    const count = (seen.get(column.name) ?? 0) + 1
    seen.set(column.name, count)
    return count === 1 ? column.name : `${column.name}_${count}`
  })
}

export function toJson(input: GridExportInput): string {
  const keys = uniqueKeys(input.columns)
  const objects = input.rows.map((row) =>
    Object.fromEntries(keys.map((key, index) => [key, wholeText(row[index] ?? null)]))
  )
  return JSON.stringify(objects, null, 2)
}

/** One INSERT per row; numbers stay unquoted, everything else becomes a string literal. */
export function toInsertSql(
  input: GridExportInput,
  options: { table: string; driver: DatabaseDriver }
): string {
  const columnList = input.columns
    .map((column) => quoteSqlName(column.name, options.driver))
    .join(', ')
  return input.rows
    .map((row) => {
      const values = input.columns
        .map((column, index) =>
          sqlLiteral(
            wholeText(row[index] ?? null),
            isNumericColumnType(column.typeName),
            options.driver
          )
        )
        .join(', ')
      return `INSERT INTO ${options.table} (${columnList}) VALUES (${values});`
    })
    .join('\n')
}
