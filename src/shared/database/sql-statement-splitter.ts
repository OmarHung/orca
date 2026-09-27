export type SqlDialect = 'postgres'

export type SqlStatementRange = {
  /** Offset of the first token; leading whitespace and comments are excluded. */
  start: number
  /** Offset just past the last token; the `;` terminator is excluded. */
  end: number
  /** Offset just past the `;`, or `end` when the statement is unterminated. */
  terminatorEnd: number
  text: string
}

type DialectRules = {
  /** `E'...'` strings, where backslash escapes the next character. */
  escapeStrings: boolean
  /** `$tag$ ... $tag$` bodies, which may contain unquoted semicolons. */
  dollarQuotes: boolean
  nestedBlockComments: boolean
}

const DIALECT_RULES: Record<SqlDialect, DialectRules> = {
  postgres: { escapeStrings: true, dollarQuotes: true, nestedBlockComments: true }
}

const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[\w$\u0080-￿]/.test(char)
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f'
}

function skipQuoted(sql: string, from: number, quote: string, backslashEscapes: boolean): number {
  let index = from + 1
  while (index < sql.length) {
    const char = sql[index]
    if (backslashEscapes && char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      if (sql[index + 1] !== quote) {
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

function readDollarDelimiter(sql: string, from: number): string | null {
  if (isIdentifierChar(sql[from - 1])) {
    return null
  }
  DOLLAR_TAG.lastIndex = from
  return DOLLAR_TAG.exec(sql)?.[0] ?? null
}

/** Length of the token starting at `index` when it is a string, quoted name, or dollar body. */
function quotedTokenEnd(sql: string, index: number, rules: DialectRules): number | null {
  const char = sql[index]
  if (char === "'") {
    const prefix = sql[index - 1]
    const isEscapeString =
      rules.escapeStrings && (prefix === 'E' || prefix === 'e') && !isIdentifierChar(sql[index - 2])
    return skipQuoted(sql, index, "'", isEscapeString)
  }
  if (char === '"') {
    return skipQuoted(sql, index, '"', false)
  }
  if (char === '$' && rules.dollarQuotes) {
    const delimiter = readDollarDelimiter(sql, index)
    if (delimiter) {
      const close = sql.indexOf(delimiter, index + delimiter.length)
      return close === -1 ? sql.length : close + delimiter.length
    }
  }
  return null
}

/** Splits a script into statements the way the server will see them, ignoring `;` inside literals. */
export function splitSqlStatements(sql: string, dialect: SqlDialect): SqlStatementRange[] {
  const rules = DIALECT_RULES[dialect]
  const statements: SqlStatementRange[] = []
  let tokenStart: number | null = null
  let lastTokenEnd = 0

  const flush = (terminatorEnd: number): void => {
    if (tokenStart !== null) {
      statements.push({
        start: tokenStart,
        end: lastTokenEnd,
        terminatorEnd,
        text: sql.slice(tokenStart, lastTokenEnd)
      })
    }
    tokenStart = null
  }

  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (char === ';') {
      flush(index + 1)
      index += 1
      continue
    }
    if (sql.startsWith('--', index) || sql.startsWith('/*', index)) {
      const isLine = char === '-'
      const newline = sql.indexOf('\n', index)
      const end = isLine
        ? newline === -1
          ? sql.length
          : newline
        : skipBlockComment(sql, index, rules.nestedBlockComments)
      if (tokenStart !== null) {
        // Why: comments inside a statement belong to it, but not their trailing blanks.
        lastTokenEnd = index + sql.slice(index, end).trimEnd().length
      }
      index = end
      continue
    }
    if (isWhitespace(char)) {
      index += 1
      continue
    }
    const end = quotedTokenEnd(sql, index, rules) ?? index + 1
    tokenStart ??= index
    lastTokenEnd = end
    index = end
  }
  if (tokenStart !== null) {
    flush(lastTokenEnd)
  }
  return statements
}

/**
 * The statement a Run-at-caret should execute: the one containing `offset`, else the one
 * just before it (caret on a blank line after a statement), else the first one after it.
 */
export function findSqlStatementAtOffset(
  statements: readonly SqlStatementRange[],
  offset: number
): SqlStatementRange | null {
  const containing = statements.find(
    (statement) => offset >= statement.start && offset <= statement.terminatorEnd
  )
  if (containing) {
    return containing
  }
  const preceding = statements.findLast((statement) => statement.terminatorEnd <= offset)
  return preceding ?? statements.find((statement) => statement.start >= offset) ?? null
}
