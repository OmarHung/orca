/** The statement's first keyword (`UPDATE`, `CREATE`…), used to label command results. */
export function leadingKeyword(sql: string): string {
  return /^[A-Za-z]+/.exec(sql.trimStart())?.[0]?.toUpperCase() ?? ''
}

// `WITH` reaches here only when the statement returned no rows, i.e. a CTE-led DML.
const ROW_CHANGING_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'MERGE', 'WITH'])

/**
 * The count to show for a command. MySQL reports 0 and SQLite repeats the last DML's count
 * for statements that change no rows (CREATE, BEGIN…), so only row-changing ones keep theirs.
 */
export function commandRowCount(sql: string, reported: number | null): number | null {
  return ROW_CHANGING_KEYWORDS.has(leadingKeyword(sql)) ? reported : null
}
