import type { SqlLanguage } from 'sql-formatter'
import type { SqlDialect } from '../../../../../shared/database/sql-dialect-lexing'
import { splitSqlStatements } from '../../../../../shared/database/sql-statement-splitter'

const FORMATTER_LANGUAGE: Record<SqlDialect, SqlLanguage> = {
  postgres: 'postgresql',
  mysql: 'mysql',
  sqlserver: 'transactsql',
  sqlite: 'sqlite'
}

export type SqlFormatEdit = { start: number; end: number; text: string }

export type SqlFormatResult = {
  edits: SqlFormatEdit[]
  /** The first statement the formatter couldn't parse, left as it was. */
  failure: { statement: string; message: string } | null
}

/**
 * Reformats each statement on its own, so `GO`/`DELIMITER` lines, comments between statements
 * and terminators stay as typed. With a range, only statements it touches are formatted.
 */
export async function formatSqlConsole(
  text: string,
  dialect: SqlDialect,
  range: { start: number; end: number } | null,
  tabWidth: number
): Promise<SqlFormatResult> {
  const { format } = await import('sql-formatter')
  const statements = splitSqlStatements(text, dialect).filter(
    (statement) => !range || (statement.end > range.start && statement.start < range.end)
  )
  const edits: SqlFormatEdit[] = []
  let failure: SqlFormatResult['failure'] = null
  for (const statement of statements) {
    try {
      const formatted = format(statement.text, {
        language: FORMATTER_LANGUAGE[dialect],
        keywordCase: 'preserve',
        tabWidth
      })
      if (formatted !== statement.text) {
        edits.push({ start: statement.start, end: statement.end, text: formatted })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error)
      failure ??= { statement: statement.text, message }
    }
  }
  return { edits, failure }
}
