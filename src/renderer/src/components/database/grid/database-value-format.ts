import {
  isDatabaseTruncatedCell,
  type DatabaseCell,
  type DatabaseColumn
} from '../../../../../shared/database/database-query-types'

export type ViewerValue =
  | { kind: 'null' }
  | {
      kind: 'text'
      text: string
      isJson: boolean
      /** Full length when the grid only holds a preview of the value. */
      truncatedFrom: number | null
    }

const JSON_TYPE = /^jsonb?$/i

function prettyJson(text: string, declaredJson: boolean): string | null {
  const trimmed = text.trim()
  if (!declaredJson && !/^[[{]/.test(trimmed)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : null
  } catch {
    return null
  }
}

/** What the value viewer shows: JSON objects/arrays pretty-printed, everything else verbatim. */
export function viewerValue(cell: DatabaseCell, column: DatabaseColumn): ViewerValue {
  if (cell === null) {
    return { kind: 'null' }
  }
  if (isDatabaseTruncatedCell(cell)) {
    // Why no JSON formatting: a preview is cut mid-value and would never parse.
    return { kind: 'text', text: cell.preview, isJson: false, truncatedFrom: cell.length }
  }
  const json = prettyJson(cell, JSON_TYPE.test(column.typeName.trim()))
  return json === null
    ? { kind: 'text', text: cell, isJson: false, truncatedFrom: null }
    : { kind: 'text', text: json, isJson: true, truncatedFrom: null }
}
