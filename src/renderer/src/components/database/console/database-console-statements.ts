import {
  isSqlDriver,
  type DatabaseDriver
} from '../../../../../shared/database/database-connection-types'
import { splitMongoStatements } from '../../../../../shared/database/mongodb-statement-splitter'
import { splitRedisCommands } from '../../../../../shared/database/redis-command-text'
import {
  findSqlStatementAtOffset,
  splitSqlBatches,
  splitSqlStatements,
  type SqlStatementRange
} from '../../../../../shared/database/sql-statement-splitter'

export type DatabaseRunMode = 'current' | 'all'

/** What a console speaks: a SQL dialect, Redis commands or mongosh statements. */
export type DatabaseConsoleLanguage = DatabaseDriver

/** The units Run executes; SQL Server's selections and whole consoles go as `GO` batches. */
function runUnits(text: string, language: DatabaseConsoleLanguage): SqlStatementRange[] {
  if (language === 'redis') {
    return splitRedisCommands(text)
  }
  if (language === 'mongodb') {
    return splitMongoStatements(text)
  }
  return splitSqlBatches(text, language)
}

function statements(text: string, language: DatabaseConsoleLanguage): SqlStatementRange[] {
  return isSqlDriver(language) ? splitSqlStatements(text, language) : runUnits(text, language)
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
  language: DatabaseConsoleLanguage
): SqlStatementRange[] {
  if (mode === 'all') {
    return runUnits(text, language)
  }
  if (selection && selection.end > selection.start) {
    const shift = selection.start
    return runUnits(text.slice(selection.start, selection.end), language).map((statement) => ({
      ...statement,
      start: statement.start + shift,
      end: statement.end + shift,
      terminatorEnd: statement.terminatorEnd + shift
    }))
  }
  const statement = findSqlStatementAtOffset(statements(text, language), caretOffset)
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
