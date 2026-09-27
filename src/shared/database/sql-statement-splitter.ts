import {
  SQL_DIALECT_RULES,
  commentEnd,
  isIdentifierChar,
  isWhitespace,
  quotedTokenEnd,
  type SqlDialect,
  type SqlDialectRules
} from './sql-dialect-lexing'

export type { SqlDialect } from './sql-dialect-lexing'

export type SqlStatementRange = {
  /** Offset of the first token; leading whitespace and comments are excluded. */
  start: number
  /** Offset just past the last token; the terminator is excluded. */
  end: number
  /** Offset just past the terminator, or `end` when the statement is unterminated. */
  terminatorEnd: number
  text: string
}

type Terminators = { semicolons: boolean }

const GO_LINE = /go(?:[ \t]+\d+)?[ \t]*(?=\r?\n|$)/iy
const DELIMITER_LINE = /delimiter[ \t]+(\S+)[ \t]*(?=\r?\n|$)/iy
const WORD = /[A-Za-z_]\w*/y

function lineEnd(sql: string, from: number): number {
  const newline = sql.indexOf('\n', from)
  return newline === -1 ? sql.length : newline
}

function atBlankLineStart(sql: string, index: number): boolean {
  let cursor = index - 1
  while (cursor >= 0 && (sql[cursor] === ' ' || sql[cursor] === '\t')) {
    cursor -= 1
  }
  return cursor < 0 || sql[cursor] === '\n'
}

function matchAt(pattern: RegExp, sql: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index
  return pattern.exec(sql)
}

/** Tracks SQLite `CREATE TRIGGER … BEGIN … END`, where `;` belongs to the body. */
class TriggerBodyTracker {
  private leading: string[] = []
  private depth = 0

  reset(): void {
    this.leading = []
    this.depth = 0
  }

  get insideBody(): boolean {
    return this.depth > 0
  }

  onWord(word: string): void {
    const lower = word.toLowerCase()
    if (this.leading.length < 3) {
      this.leading.push(lower)
    }
    if (!this.isTrigger()) {
      return
    }
    if (lower === 'begin' || lower === 'case') {
      this.depth += 1
    } else if (lower === 'end' && this.depth > 0) {
      this.depth -= 1
    }
  }

  private isTrigger(): boolean {
    const [first, second, third] = this.leading
    return (
      first === 'create' &&
      (second === 'trigger' ||
        ((second === 'temp' || second === 'temporary') && third === 'trigger'))
    )
  }
}

function scan(sql: string, rules: SqlDialectRules, terminators: Terminators): SqlStatementRange[] {
  const statements: SqlStatementRange[] = []
  const trigger = new TriggerBodyTracker()
  let delimiter = ';'
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
    trigger.reset()
  }

  let index = 0
  while (index < sql.length) {
    const lineStart = atBlankLineStart(sql, index)
    const delimiterLine =
      rules.delimiterCommand && tokenStart === null && lineStart
        ? matchAt(DELIMITER_LINE, sql, index)
        : null
    if (delimiterLine) {
      delimiter = delimiterLine[1]!
      index = lineEnd(sql, index)
      continue
    }
    if (rules.goBatches && lineStart && matchAt(GO_LINE, sql, index)) {
      const end = lineEnd(sql, index)
      flush(end)
      index = end
      continue
    }
    if (terminators.semicolons && !trigger.insideBody && sql.startsWith(delimiter, index)) {
      flush(index + delimiter.length)
      index += delimiter.length
      continue
    }
    const comment = commentEnd(sql, index, rules)
    if (comment !== null) {
      if (tokenStart !== null) {
        // Why: comments inside a statement belong to it, but not their trailing blanks.
        lastTokenEnd = index + sql.slice(index, comment).trimEnd().length
      }
      index = comment
      continue
    }
    if (isWhitespace(sql[index])) {
      index += 1
      continue
    }
    let end = quotedTokenEnd(sql, index, rules)
    if (end === null && !isIdentifierChar(sql[index - 1])) {
      const word = matchAt(WORD, sql, index)?.[0]
      if (word) {
        trigger.onWord(word)
        end = index + word.length
      }
    }
    end ??= index + 1
    tokenStart ??= index
    lastTokenEnd = end
    index = end
  }
  if (tokenStart !== null) {
    flush(lastTokenEnd)
  }
  return statements
}

/** Splits a script into statements the way the server will see them, ignoring `;` inside literals. */
export function splitSqlStatements(sql: string, dialect: SqlDialect): SqlStatementRange[] {
  return scan(sql, SQL_DIALECT_RULES[dialect], { semicolons: true })
}

/**
 * Units to send as one request. SQL Server sends whole `GO` batches so `DECLARE`d variables
 * stay in scope; every other dialect sends one statement at a time.
 */
export function splitSqlBatches(sql: string, dialect: SqlDialect): SqlStatementRange[] {
  const rules = SQL_DIALECT_RULES[dialect]
  return scan(sql, rules, { semicolons: !rules.goBatches })
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
