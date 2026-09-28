/**
 * A cell too large to ship whole; the grid shows the preview and the full length. The worker
 * keeps the full text within a budget, for copy and export to read in bounded slices.
 */
export type DatabaseTruncatedCell = { preview: string; length: number }

/** Characters `[start, end)` of the long value at `row` (from the result's first) and `column`. */
export type DatabaseLongValueSlice = { row: number; column: number; start: number; end: number }

/** Null where the worker no longer holds that value (evicted, over budget, or restarted). */
export type DatabaseLongValues = { values: (string | null)[] }

// Why caps on one read: every reply crosses IPC, so a copy or export reads in bounded steps.
export const DATABASE_LONG_VALUE_READ_MAX_CHARS = 4 * 1024 * 1024
export const DATABASE_LONG_VALUE_READ_MAX_SLICES = 1_000

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
export type DatabaseExecuteResult = {
  results: DatabaseQueryResult[]
  /** Where unqualified names now resolve, when a statement switched it (USE, SET search_path). */
  schema?: string
  /** The console's database, when a statement switched it (SQL Server's USE). */
  database?: string
}

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
