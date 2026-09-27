/** A cell too large to ship whole; the grid shows the preview and the full length. */
export type DatabaseTruncatedCell = { preview: string; length: number }

/**
 * Cells travel as the database's own text form (not JS numbers or Dates) so numeric
 * precision and timestamp formatting survive, and edits can match rows exactly.
 */
export type DatabaseCell = string | null | DatabaseTruncatedCell

export type DatabaseColumn = { name: string; typeName: string }

export type DatabaseRowsResult = {
  kind: 'rows'
  resultId: string
  columns: DatabaseColumn[]
  rows: DatabaseCell[][]
  hasMore: boolean
  durationMs: number
}

export type DatabaseCommandResult = {
  kind: 'command'
  command: string
  rowCount: number | null
  durationMs: number
}

export type DatabaseQueryResult = DatabaseRowsResult | DatabaseCommandResult

/** One executed batch; SQL Server batches and MySQL procedures can return several result sets. */
export type DatabaseExecuteResult = { results: DatabaseQueryResult[] }

export type DatabaseRowsPage = {
  rows: DatabaseCell[][]
  hasMore: boolean
  /** Result sets the batch produced after the paged one finished. */
  followingResults?: DatabaseQueryResult[]
}

export type DatabaseErrorCode = 'password-required' | 'not-connected' | 'cancelled' | 'unavailable'

export type DatabaseError = {
  message: string
  /** Orca's own code when the renderer must react (e.g. prompt for a password). */
  code?: DatabaseErrorCode
  /** Server error code, e.g. PostgreSQL SQLSTATE `42P01`. */
  sqlState?: string
  /** 1-based character offset into the executed statement. */
  position?: number
  /** 1-based line in the executed statement, when the server reports lines instead of offsets. */
  line?: number
  detail?: string
  hint?: string
}

export type DatabaseResult<T> = { ok: true; value: T } | { ok: false; error: DatabaseError }

export function isDatabaseTruncatedCell(cell: DatabaseCell): cell is DatabaseTruncatedCell {
  return typeof cell === 'object' && cell !== null
}

export function databaseCellText(cell: DatabaseCell): string | null {
  if (cell === null) {
    return null
  }
  return isDatabaseTruncatedCell(cell) ? cell.preview : cell
}
