import {
  SQL_DIALECT_RULES,
  commentEnd,
  isIdentifierChar,
  quotedTokenEnd,
  type SqlDialect
} from '../../../shared/database/sql-dialect-lexing'

// Keywords that write data, change schema or run code that could; `into` catches SELECT … INTO.
const WRITE_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'into',
  'create',
  'alter',
  'drop',
  'truncate',
  'grant',
  'revoke',
  'deny',
  'exec',
  'execute',
  'bulk',
  'backup',
  'restore',
  'dbcc',
  'kill',
  'shutdown',
  'reconfigure'
])

/**
 * Best-effort read-only enforcement for servers without a session read-only mode (SQL Server):
 * returns the first write keyword outside strings, quoted names and comments.
 */
export function findWriteKeyword(sql: string, dialect: SqlDialect): string | null {
  const rules = SQL_DIALECT_RULES[dialect]
  let index = 0
  while (index < sql.length) {
    const skipped = commentEnd(sql, index, rules) ?? quotedTokenEnd(sql, index, rules)
    if (skipped !== null) {
      index = skipped
      continue
    }
    const word = isIdentifierChar(sql[index - 1])
      ? null
      : /^[A-Za-z_]\w*/.exec(sql.slice(index, index + 64))
    if (word) {
      if (WRITE_KEYWORDS.has(word[0].toLowerCase())) {
        return word[0]
      }
      index += word[0].length
      continue
    }
    index += 1
  }
  return null
}

export function assertReadOnlySql(sql: string, dialect: SqlDialect): void {
  const keyword = findWriteKeyword(sql, dialect)
  if (keyword) {
    throw new Error(
      `This connection is read-only, so Orca did not run a statement containing ${keyword.toUpperCase()}.`
    )
  }
}
