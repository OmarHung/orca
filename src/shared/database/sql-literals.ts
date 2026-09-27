import type { DatabaseDriver } from './database-connection-types'

const NUMERIC_TEXT = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/**
 * A value written as SQL source, for SQL a person reads or copies (never for execution,
 * which always binds values as parameters). Numbers in numeric columns stay unquoted.
 */
export function sqlLiteral(value: string | null, numeric: boolean, driver: DatabaseDriver): string {
  if (value === null) {
    return 'NULL'
  }
  if (numeric && NUMERIC_TEXT.test(value)) {
    return value
  }
  // Why only MySQL: its default sql_mode treats backslash as an escape inside strings.
  const escaped = driver === 'mysql' ? value.replaceAll('\\', '\\\\') : value
  return `'${escaped.replaceAll("'", "''")}'`
}
