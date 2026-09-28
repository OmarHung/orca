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

/** Pixel width of a text in the grid font; the renderer measures it, tests estimate it. */
export type MeasureGridText = (text: string) => number

export function estimateGridTextWidth(text: string): number {
  return text.length * CHAR_PX
}

/** The single-line form a cell shows in the grid (newlines collapse, like DataGrip). */
export function gridCellDisplayText(cell: DatabaseCell): string | null {
  const text = databaseCellText(cell)
  return text === null ? null : text.replace(/\r?\n/g, '↵')
}

// Room for the sort arrow beside a header name.
const SORT_ICON_PX = 16

function widestColumnPx(
  column: DatabaseColumn,
  rows: readonly DatabaseCell[][],
  index: number,
  limits: { sampleRows: number; maxPx: number },
  measure: MeasureGridText
): number {
  let width =
    Math.max(measure(column.name) + SORT_ICON_PX, measure(column.typeName)) + CELL_PADDING_PX
  const sample = Math.min(rows.length, limits.sampleRows)
  for (let row = 0; row < sample && width < limits.maxPx; row += 1) {
    const text = gridCellDisplayText(rows[row]?.[index] ?? null)
    if (text !== null) {
      width = Math.max(width, measure(text) + CELL_PADDING_PX)
    }
  }
  return Math.min(limits.maxPx, Math.max(GRID_MIN_COLUMN_PX, Math.ceil(width)))
}

/** Sizes each column to its header or widest sampled value, clamped to a readable range. */
export function measureGridColumns(
  columns: readonly DatabaseColumn[],
  rows: readonly DatabaseCell[][],
  measure: MeasureGridText = estimateGridTextWidth
): number[] {
  const limits = { sampleRows: SAMPLE_ROWS, maxPx: GRID_MAX_COLUMN_PX }
  return columns.map((column, index) => widestColumnPx(column, rows, index, limits, measure))
}

export const GRID_FIT_MAX_COLUMN_PX = 800
const FIT_SAMPLE_ROWS = 2_000

/** Double-click fit: the widest header or loaded value, allowing wider columns than the first guess. */
export function fitGridColumn(
  column: DatabaseColumn,
  rows: readonly DatabaseCell[][],
  index: number,
  measure: MeasureGridText = estimateGridTextWidth
): number {
  const limits = { sampleRows: FIT_SAMPLE_ROWS, maxPx: GRID_FIT_MAX_COLUMN_PX }
  return widestColumnPx(column, rows, index, limits, measure)
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

/** A column header's tooltip: its name, with the column's comment below when it has one. */
export function gridHeaderTitle(name: string, comment: string | undefined): string {
  return comment ? `${name}\n${comment}` : name
}
