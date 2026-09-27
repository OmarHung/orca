import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import {
  findSqlStatementAtOffset,
  splitSqlBatches,
  splitSqlStatements,
  type SqlDialect,
  type SqlStatementRange
} from '../../../../../shared/database/sql-statement-splitter'

export type DatabaseRunMode = 'current' | 'all'

export function sqlDialectForDriver(driver: DatabaseDriver): SqlDialect {
  return driver
}

/**
 * What Run executes, DataGrip-style: a non-empty selection runs every unit in it, otherwise the
 * statement at the caret; `all` runs the whole console. SQL Server sends selections and whole
 * consoles as `GO` batches so variables stay in scope. Offsets are console-relative.
 */
export function statementsForRun(
  text: string,
  mode: DatabaseRunMode,
  caretOffset: number,
  selection: { start: number; end: number } | null,
  dialect: SqlDialect
): SqlStatementRange[] {
  if (mode === 'all') {
    return splitSqlBatches(text, dialect)
  }
  if (selection && selection.end > selection.start) {
    const shift = selection.start
    return splitSqlBatches(text.slice(selection.start, selection.end), dialect).map(
      (statement) => ({
        ...statement,
        start: statement.start + shift,
        end: statement.end + shift,
        terminatorEnd: statement.terminatorEnd + shift
      })
    )
  }
  const statement = findSqlStatementAtOffset(splitSqlStatements(text, dialect), caretOffset)
  return statement ? [statement] : []
}

/** Console offset of a 1-based line inside `statement` (servers like SQL Server report lines). */
export function offsetOfStatementLine(statement: SqlStatementRange, line: number): number {
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    const newline = statement.text.indexOf('\n', offset)
    if (newline === -1) {
      break
    }
    offset = newline + 1
  }
  const leading = /^[ \t]*/.exec(statement.text.slice(offset))?.[0].length ?? 0
  return statement.start + offset + leading
}
