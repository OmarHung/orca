import {
  findSqlStatementAtOffset,
  splitSqlStatements,
  type SqlStatementRange
} from '../../../../../shared/database/sql-statement-splitter'

export type DatabaseRunMode = 'current' | 'all'

/**
 * What Run executes, DataGrip-style: a non-empty selection runs every statement in it,
 * otherwise the statement at the caret; `all` runs the whole console.
 * Offsets in the returned ranges are relative to the full console text.
 */
export function statementsForRun(
  text: string,
  mode: DatabaseRunMode,
  caretOffset: number,
  selection: { start: number; end: number } | null
): SqlStatementRange[] {
  if (mode === 'all') {
    return splitSqlStatements(text, 'postgres')
  }
  if (selection && selection.end > selection.start) {
    const shift = selection.start
    return splitSqlStatements(text.slice(selection.start, selection.end), 'postgres').map(
      (statement) => ({
        ...statement,
        start: statement.start + shift,
        end: statement.end + shift,
        terminatorEnd: statement.terminatorEnd + shift
      })
    )
  }
  const statement = findSqlStatementAtOffset(splitSqlStatements(text, 'postgres'), caretOffset)
  return statement ? [statement] : []
}
