import type { DatabaseHistoryEntry } from '../../../../../shared/database/database-query-history-types'

/** One line per statement: runs of whitespace (newlines, indentation) become one space. */
export function historyPreview(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Entries whose SQL contains every word of the query, in any order and case. */
export function filterHistory(
  entries: readonly DatabaseHistoryEntry[],
  query: string
): DatabaseHistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return [...entries]
  }
  return entries.filter((entry) => {
    const sql = entry.sql.toLowerCase()
    return words.every((word) => sql.includes(word))
  })
}
