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

/** The single-line form a cell shows in the grid (newlines collapse, like DataGrip). */
export function gridCellDisplayText(cell: DatabaseCell): string | null {
  const text = databaseCellText(cell)
  return text === null ? null : text.replace(/\r?\n/g, '↵')
}
