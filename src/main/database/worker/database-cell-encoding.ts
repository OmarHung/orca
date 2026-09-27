import type { DatabaseCell } from '../../../shared/database/database-query-types'

/** Longer values ship as a preview; the grid shows the true length. */
export const DATABASE_CELL_PREVIEW_MAX_CHARS = 10_000

export function encodeTextCell(value: unknown): DatabaseCell {
  if (value === null || value === undefined) {
    return null
  }
  const text = typeof value === 'string' ? value : String(value)
  if (text.length <= DATABASE_CELL_PREVIEW_MAX_CHARS) {
    return text
  }
  return { preview: text.slice(0, DATABASE_CELL_PREVIEW_MAX_CHARS), length: text.length }
}
