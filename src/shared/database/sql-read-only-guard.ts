import {
  SQL_DIALECT_RULES,
  commentEnd,
  isIdentifierChar,
  isWhitespace,
  quotedTokenEnd,
  type SqlDialect,
  type SqlDialectRules
} from './sql-dialect-lexing'
import { splitSqlStatements } from './sql-statement-splitter'

// Orca's database tools are read-only. The server enforces it (read-only sessions, SQL Server's
// rolled-back transactions); this check refuses writes before they are sent, with a clear reason.

/** Statement-leading words that change data, schema, permissions, files or server state. */
const WRITE_STATEMENTS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'REPLACE',
  'UPSERT',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'DENY',
  'REASSIGN',
  'COMMENT',
  'SECURITY',
  'VACUUM',
  'REINDEX',
  'CLUSTER',
  'ANALYZE',
  'OPTIMIZE',
  'REPAIR',
  'COPY',
  'LOAD',
  'IMPORT',
  'ATTACH',
  'DETACH',
  'BACKUP',
  'RESTORE',
  'DBCC',
  'KILL',
  'SHUTDOWN',
  'CHECKPOINT',
  'RECONFIGURE',
  'INSTALL',
  'UNINSTALL',
  'LOCK',
  'REFRESH',
  'PURGE',
  'FLUSH',
  'HANDLER',
  'BULK',
  'DO',
  'RESET',
  'DISCARD'
])

/** Words that write wherever they appear: a CTE's DELETE, a statement after another. */
const WRITE_WORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'TRUNCATE',
  'DROP',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'COMMIT',
  'ROLLBACK'
])

/** Settings that would take a session out of read-only. */
const READ_ONLY_SETTINGS = new Set([
  'DEFAULT_TRANSACTION_READ_ONLY',
  'TRANSACTION_READ_ONLY',
  'TX_READ_ONLY',
  'IMPLICIT_TRANSACTIONS'
])

/**
 * Ways out of read-only however they are written (`set_config(…)`, `@@session.x`), and SQL
 * Server's dynamic SQL, whose text (a COMMIT, say) no check can read.
 */
const ESCAPES = new Set([...READ_ONLY_SETTINGS, 'SET_CONFIG', 'SP_EXECUTESQL'])

const SERVER_SCOPES = new Set(['GLOBAL', 'PERSIST', 'PERSIST_ONLY'])

// Why SQL Server scans everything: a T-SQL batch needs no `;` between statements, so a statement's
// first word can sit anywhere in it.
const ANYWHERE: Record<SqlDialect, ReadonlySet<string>> = {
  postgres: WRITE_WORDS,
  mysql: WRITE_WORDS,
  sqlite: WRITE_WORDS,
  sqlserver: new Set([...WRITE_WORDS, ...WRITE_STATEMENTS].filter((word) => word !== 'DO'))
}

const WORD = /[A-Za-z_][\w$]*/y

type Word = { text: string; before: string | undefined; after: string | undefined }

function neighbour(sql: string, from: number, step: 1 | -1): string | undefined {
  let index = from
  while (index >= 0 && index < sql.length && isWhitespace(sql[index])) {
    index += step
  }
  return sql[index]
}

/** Bare words, skipping literals, comments and quoted names. */
function words(sql: string, rules: SqlDialectRules): Word[] {
  const found: Word[] = []
  let index = 0
  while (index < sql.length) {
    const skipped = commentEnd(sql, index, rules) ?? quotedTokenEnd(sql, index, rules)
    if (skipped !== null) {
      index = skipped
      continue
    }
    WORD.lastIndex = index
    const match = isIdentifierChar(sql[index - 1]) ? null : WORD.exec(sql)
    if (!match) {
      index += 1
      continue
    }
    const end = index + match[0].length
    found.push({
      text: match[0].toUpperCase(),
      before: neighbour(sql, index - 1, -1),
      after: neighbour(sql, end, 1)
    })
    index = end
  }
  return found
}

function statementViolation(sql: string, dialect: SqlDialect): string | null {
  // Why skip these: `t.update` is a column and `replace(…)` / MySQL's `insert(…)` are functions.
  const all = words(sql, SQL_DIALECT_RULES[dialect])
  const keywords = all.filter((word) => word.before !== '.' && word.after !== '(')
  const first = all[0]?.text
  if (first && WRITE_STATEMENTS.has(first)) {
    return first
  }
  for (const word of all) {
    const dynamicSql = (word.text === 'EXEC' || word.text === 'EXECUTE') && word.after === '('
    if (ESCAPES.has(word.text) || (dialect === 'sqlserver' && dynamicSql)) {
      return word.text
    }
  }
  const anywhere = ANYWHERE[dialect]
  for (const [index, word] of keywords.entries()) {
    const next = keywords[index + 1]?.text
    if (anywhere.has(word.text)) {
      return word.text
    }
    if (word.text === 'READ' && next === 'WRITE') {
      return 'READ WRITE'
    }
    if (word.text === 'INTO' && (next === 'OUTFILE' || next === 'DUMPFILE')) {
      return `INTO ${next}`
    }
    if (first === 'SET' && SERVER_SCOPES.has(word.text)) {
      return 'SET GLOBAL'
    }
  }
  return null
}

/** The word that makes `sql` a write (e.g. `DELETE`, `READ WRITE`), or null for a read. */
export function readOnlyViolation(sql: string, dialect: SqlDialect): string | null {
  for (const statement of splitSqlStatements(sql, dialect)) {
    const violation = statementViolation(statement.text, dialect)
    if (violation) {
      return violation
    }
  }
  return null
}
