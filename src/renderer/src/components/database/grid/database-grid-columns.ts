import {
  databaseCellText,
  type DatabaseCell,
  type DatabaseColumn
} from '../../../../../shared/database/database-query-types'

export const GRID_MIN_COLUMN_PX = 72
export const GRID_MAX_COLUMN_PX = 360
export const GRID_ROW_NUMBER_PX = 56
const CHAR_PX = 7
const CELL_PADDING_PX = 24
const SAMPLE_ROWS = 200

const NUMERIC_TYPE =
  /^(?:(?:small|big)?int(?:eger|[248])?|numeric|decimal|real|double precision|float[48]?|money|(?:small|big)?serial[248]?)(?:\(|$)/i

export function isNumericColumnType(typeName: string): boolean {
  return NUMERIC_TYPE.test(typeName.trim())
}

function textWidth(text: string): number {
  return text.length * CHAR_PX + CELL_PADDING_PX
}

/** Sizes each column to its header or widest sampled value, clamped to a readable range. */
export function measureGridColumns(
  columns: readonly DatabaseColumn[],
  rows: readonly DatabaseCell[][]
): number[] {
  return columns.map((column, index) => {
    let width = Math.max(textWidth(column.name), textWidth(column.typeName))
    const sample = Math.min(rows.length, SAMPLE_ROWS)
    for (let row = 0; row < sample && width < GRID_MAX_COLUMN_PX; row += 1) {
      const text = databaseCellText(rows[row]?.[index] ?? null)
      if (text !== null) {
        width = Math.max(width, textWidth(text.split('\n', 1)[0] ?? ''))
      }
    }
    return Math.min(GRID_MAX_COLUMN_PX, Math.max(GRID_MIN_COLUMN_PX, width))
  })
}

export const GRID_FIT_MAX_COLUMN_PX = 800
const FIT_SAMPLE_ROWS = 2_000

/** Double-click fit: the widest header or loaded value, allowing wider columns than the first guess. */
export function fitGridColumn(
  column: DatabaseColumn,
  rows: readonly DatabaseCell[][],
  index: number
): number {
  let width = Math.max(textWidth(column.name), textWidth(column.typeName))
  const sample = Math.min(rows.length, FIT_SAMPLE_ROWS)
  for (let row = 0; row < sample; row += 1) {
    const text = databaseCellText(rows[row]?.[index] ?? null)
    if (text !== null) {
      width = Math.max(width, textWidth(text.split('\n', 1)[0] ?? ''))
    }
  }
  return Math.min(GRID_FIT_MAX_COLUMN_PX, Math.max(GRID_MIN_COLUMN_PX, width))
}

/** The single-line form a cell shows in the grid (newlines collapse, like DataGrip). */
export function gridCellDisplayText(cell: DatabaseCell): string | null {
  const text = databaseCellText(cell)
  return text === null ? null : text.replace(/\r?\n/g, '↵')
}

/** The scrollLeft that brings a column fully into view beside the sticky row numbers. */
export function scrollLeftToReveal(
  widths: readonly number[],
  column: number,
  scrollLeft: number,
  clientWidth: number
): number {
  const left = widths.slice(0, column).reduce((sum, width) => sum + width, GRID_ROW_NUMBER_PX)
  const right = left + (widths[column] ?? 0)
  if (left - GRID_ROW_NUMBER_PX < scrollLeft) {
    return left - GRID_ROW_NUMBER_PX
  }
  // Why min: a column wider than the viewport shows its left edge rather than its right.
  return right > scrollLeft + clientWidth
    ? Math.min(right - clientWidth, left - GRID_ROW_NUMBER_PX)
    : scrollLeft
}
