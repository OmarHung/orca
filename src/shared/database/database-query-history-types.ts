export type DatabaseHistoryOutcome = 'ok' | 'error' | 'cancelled'

/** One statement run from a console. */
export type DatabaseHistoryEntry = {
  sql: string
  /** Epoch milliseconds when it finished. */
  at: number
  outcome: DatabaseHistoryOutcome
  durationMs: number
}

/** Entries kept per connection; the oldest drop off first. */
export const DATABASE_HISTORY_LIMIT = 500
/** Longer statements (pasted dumps, generated scripts) aren't worth recalling. */
export const DATABASE_HISTORY_MAX_SQL_CHARS = 64 * 1024
/** Every run rewrites the file, so the oldest entries go once their SQL passes this. */
export const DATABASE_HISTORY_MAX_TOTAL_CHARS = 2 * 1024 * 1024
