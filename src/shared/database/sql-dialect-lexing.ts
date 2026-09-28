export type SqlDialect = 'postgres' | 'mysql' | 'sqlserver' | 'sqlite'

export type SqlDialectRules = {
  /** PostgreSQL `E'...'` strings, where backslash escapes the next character. */
  escapeStrings: boolean
  /** MySQL: backslash escapes inside both '...' and "...". */
  backslashStrings: boolean
  /** PostgreSQL `$tag$ ... $tag$` bodies. */
  dollarQuotes: boolean
  nestedBlockComments: boolean
  /** MySQL `#` line comments; its `--` also needs whitespace after it. */
  mysqlComments: boolean
  backtickIdentifiers: boolean
  bracketIdentifiers: boolean
  /** SQL Server `GO` lines end a batch. */
  goBatches: boolean
  /** MySQL client `DELIMITER x` lines. */
  delimiterCommand: boolean
  /** SQLite `CREATE TRIGGER … BEGIN … END` bodies contain semicolons. */
  triggerBodies: boolean
}

const NONE: SqlDialectRules = {
  escapeStrings: false,
  backslashStrings: false,
  dollarQuotes: false,
  nestedBlockComments: false,
  mysqlComments: false,
  backtickIdentifiers: false,
  bracketIdentifiers: false,
  goBatches: false,
  delimiterCommand: false,
  triggerBodies: false
}

export const SQL_DIALECT_RULES: Record<SqlDialect, SqlDialectRules> = {
  postgres: { ...NONE, escapeStrings: true, dollarQuotes: true, nestedBlockComments: true },
  mysql: {
    ...NONE,
    backslashStrings: true,
    mysqlComments: true,
    backtickIdentifiers: true,
    delimiterCommand: true
  },
  sqlserver: { ...NONE, nestedBlockComments: true, bracketIdentifiers: true, goBatches: true },
  sqlite: { ...NONE, backtickIdentifiers: true, bracketIdentifiers: true, triggerBodies: true }
}

const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y
// MySQL `/*!50700` and MariaDB `/*M!100100`, with their optional minimum server version.
const EXECUTABLE_CODE_OPENER = /\/\*M?!\d*/y

export function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[\w$\u0080-￿]/.test(char)
}

export function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f'
}

/** End of a quoted token opened at `from`; a doubled close quote is an escaped one. */
function skipQuoted(sql: string, from: number, close: string, backslashEscapes: boolean): number {
  let index = from + 1
  while (index < sql.length) {
    const char = sql[index]
    if (backslashEscapes && char === '\\') {
      index += 2
      continue
    }
    if (char === close) {
      if (sql[index + 1] !== close) {
        return index + 1
      }
      index += 2
      continue
    }
    index += 1
  }
  return sql.length
}

function skipBlockComment(sql: string, from: number, nested: boolean): number {
  let depth = 0
  let index = from
  while (index < sql.length) {
    if (sql.startsWith('/*', index) && (nested || depth === 0)) {
      depth += 1
      index += 2
    } else if (sql.startsWith('*/', index)) {
      depth -= 1
      index += 2
      if (depth === 0) {
        return index
      }
    } else {
      index += 1
    }
  }
  return sql.length
}

function isExecutableComment(sql: string, index: number, rules: SqlDialectRules): boolean {
  return (
    rules.mysqlComments &&
    (sql.startsWith('/*!', index) || sql.startsWith('/*M!', index) || sql.startsWith('/*+', index))
  )
}

/**
 * End of a `/*!` or `/*M!` opener when one starts at `index`, else null. The server runs the text
 * up to the next `*\/` as code; `/*+` optimizer hints are not included.
 */
export function executableCodeStart(
  sql: string,
  index: number,
  rules: SqlDialectRules
): number | null {
  if (!rules.mysqlComments) {
    return null
  }
  EXECUTABLE_CODE_OPENER.lastIndex = index
  const opener = EXECUTABLE_CODE_OPENER.exec(sql)
  return opener ? index + opener[0].length : null
}

/** End offset when a comment starts at `index`, else null. `/*!…*\/` and `/*M!…*\/` are code. */
export function commentEnd(sql: string, index: number, rules: SqlDialectRules): number | null {
  const lineComment =
    (sql.startsWith('--', index) &&
      (!rules.mysqlComments || index + 2 >= sql.length || isWhitespace(sql[index + 2]))) ||
    (rules.mysqlComments && sql[index] === '#')
  if (lineComment) {
    const newline = sql.indexOf('\n', index)
    return newline === -1 ? sql.length : newline
  }
  if (sql.startsWith('/*', index) && !isExecutableComment(sql, index, rules)) {
    return skipBlockComment(sql, index, rules.nestedBlockComments)
  }
  return null
}

function readDollarDelimiter(sql: string, from: number): string | null {
  if (isIdentifierChar(sql[from - 1])) {
    return null
  }
  DOLLAR_TAG.lastIndex = from
  return DOLLAR_TAG.exec(sql)?.[0] ?? null
}

/** End offset when a string, quoted name, dollar body or executable comment starts at `index`. */
export function quotedTokenEnd(sql: string, index: number, rules: SqlDialectRules): number | null {
  const char = sql[index]
  if (char === "'") {
    const prefix = sql[index - 1]
    const isEscapeString =
      rules.escapeStrings && (prefix === 'E' || prefix === 'e') && !isIdentifierChar(sql[index - 2])
    return skipQuoted(sql, index, "'", isEscapeString || rules.backslashStrings)
  }
  if (char === '"') {
    return skipQuoted(sql, index, '"', rules.backslashStrings)
  }
  if (char === '`' && rules.backtickIdentifiers) {
    return skipQuoted(sql, index, '`', false)
  }
  if (char === '[' && rules.bracketIdentifiers) {
    return skipQuoted(sql, index, ']', false)
  }
  if (char === '$' && rules.dollarQuotes) {
    const delimiter = readDollarDelimiter(sql, index)
    if (delimiter) {
      const close = sql.indexOf(delimiter, index + delimiter.length)
      return close === -1 ? sql.length : close + delimiter.length
    }
  }
  if (isExecutableComment(sql, index, rules)) {
    return skipBlockComment(sql, index, false)
  }
  return null
}
