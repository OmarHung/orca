import {
  SQL_DIALECT_RULES,
  commentEnd,
  isIdentifierChar,
  isWhitespace,
  quotedTokenEnd
} from './sql-dialect-lexing'

// SQL Server has no read-only session, and rolling each batch back can't undo a procedure that
// commits on its own or a sequence value once handed out. So a batch runs only when nothing in
// it can reach code Orca can't read, or state a rollback doesn't restore.

/**
 * The only procedures a read-only console runs: documented catalog and help procedures that
 * return metadata and take no option that writes (unlike, say, sp_spaceused @updateusage).
 * Matched exactly in lower case, bare or in `sys`, because that is the name SQL Server resolves
 * to the system procedure first; a user procedure can't take over `sys` or an unqualified sp_ name.
 */
export const SQL_SERVER_READ_ONLY_PROCEDURES: ReadonlySet<string> = new Set([
  'sp_help',
  'sp_helptext',
  'sp_helpindex',
  'sp_helpconstraint',
  'sp_columns',
  'sp_tables',
  'sp_pkeys',
  'sp_fkeys',
  'sp_who'
])

/** A batch's first word, when it is a statement; any other first word runs as a procedure. */
const BATCH_STARTS = new Set([
  'SELECT',
  'WITH',
  'SET',
  'DECLARE',
  'PRINT',
  'IF',
  'WHILE',
  'BEGIN',
  'RETURN',
  'GOTO',
  'USE',
  'WAITFOR',
  'RAISERROR',
  'THROW',
  'OPEN',
  'FETCH',
  'CLOSE',
  'DEALLOCATE',
  'READTEXT',
  'REVERT',
  'EXEC',
  'EXECUTE'
])

/** T-SQL statements that write outside the generic list: triggers, text, Service Broker. */
const WRITE_WORDS = new Set([
  'ENABLE',
  'DISABLE',
  'UPDATETEXT',
  'WRITETEXT',
  'RECEIVE',
  'SEND',
  'SETUSER',
  // Pass-through queries run on another server, where nothing here reaches them.
  'OPENQUERY',
  'OPENROWSET',
  'OPENDATASOURCE'
])

const WRITE_PAIRS = [
  ['BEGIN', 'DIALOG'],
  ['BEGIN', 'CONVERSATION'],
  ['END', 'CONVERSATION'],
  ['MOVE', 'CONVERSATION'],
  ['GET', 'CONVERSATION'],
  ['ADD', 'SIGNATURE'],
  ['ADD', 'COUNTER']
]

type Token = { kind: 'word' | 'name' | 'variable' | 'other'; text: string }

function unquote(token: string): string {
  const close = token.startsWith('[') ? ']' : '"'
  return token.slice(1, -1).replaceAll(close + close, close)
}

function readWhile(sql: string, from: number, test: (char: string) => boolean): number {
  let index = from
  while (index < sql.length && test(sql[index]!)) {
    index += 1
  }
  return index
}

/** The batch as words, quoted names, variables and everything else, skipping comments. */
function tokens(sql: string): Token[] {
  const rules = SQL_DIALECT_RULES.sqlserver
  const found: Token[] = []
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    const comment = commentEnd(sql, index, rules)
    const quoted = comment === null ? quotedTokenEnd(sql, index, rules) : null
    if (isWhitespace(char) || comment !== null) {
      index = comment ?? index + 1
    } else if (quoted !== null) {
      const text = sql.slice(index, quoted)
      found.push(char === "'" ? { kind: 'other', text } : { kind: 'name', text: unquote(text) })
      index = quoted
    } else if (char === '@' || (isIdentifierChar(char) && !/\d/.test(char)) || char === '#') {
      const end = readWhile(
        sql,
        index + 1,
        (next) => isIdentifierChar(next) || next === '@' || next === '#'
      )
      found.push({ kind: char === '@' ? 'variable' : 'word', text: sql.slice(index, end) })
      index = end
    } else {
      found.push({ kind: 'other', text: char })
      index += 1
    }
  }
  return found
}

const upper = (token: Token | undefined): string =>
  token?.kind === 'word' ? token.text.toUpperCase() : ''

/** Whether the procedure named from `start` is one of the read-only system procedures. */
function isReadOnlyProcedure(found: readonly Token[], start: number): boolean {
  const parts: string[] = []
  let index = start
  while (found[index]?.kind === 'word' || found[index]?.kind === 'name') {
    parts.push(found[index]!.text)
    if (found[index + 1]?.text !== '.') {
      break
    }
    index += 2
  }
  const [schema, name] = parts.length === 2 ? parts : [undefined, parts[0]]
  return (
    parts.length <= 2 &&
    (schema === undefined || schema === 'sys') &&
    name !== undefined &&
    SQL_SERVER_READ_ONLY_PROCEDURES.has(name)
  )
}

/** EXEC's target: `@status =` may lead it; a variable (`EXEC @name`) or string is dynamic. */
function execTargetIsSafe(found: readonly Token[], exec: number): boolean {
  const assigns = found[exec + 1]?.kind === 'variable' && found[exec + 2]?.text === '='
  return isReadOnlyProcedure(found, exec + (assigns ? 3 : 1))
}

/** Why the batch isn't read-only on SQL Server, or null when it is. */
export function sqlServerBatchViolation(sql: string): string | null {
  const found = tokens(sql)
  for (const [index, token] of found.entries()) {
    const word = upper(token)
    const next = upper(found[index + 1])
    if (found[index - 1]?.text === '.') {
      continue
    }
    if ((word === 'EXEC' || word === 'EXECUTE') && !execTargetIsSafe(found, index)) {
      return 'EXEC'
    }
    if (WRITE_WORDS.has(word)) {
      return word
    }
    if (WRITE_PAIRS.some(([a, b]) => a === word && b === next)) {
      return `${word} ${next}`
    }
    // Why: a sequence hands out values no rollback returns.
    if (word === 'NEXT' && next === 'VALUE' && upper(found[index + 2]) === 'FOR') {
      return 'NEXT VALUE FOR'
    }
    // SELECT … INTO makes a table; only FETCH … INTO @variable reads.
    if (word === 'INTO' && found[index + 1]?.kind !== 'variable') {
      return 'SELECT INTO'
    }
  }
  // A batch that starts with a name runs it as a procedure, EXEC or not.
  const first = found.findIndex((token) => token.text !== ';')
  const start = found[first]
  const runsProcedure = start !== undefined && start.text !== '(' && !BATCH_STARTS.has(upper(start))
  return runsProcedure && !isReadOnlyProcedure(found, first) ? 'EXEC' : null
}
