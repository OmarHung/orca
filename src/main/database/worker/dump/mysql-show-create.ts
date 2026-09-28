import { sqlLiteral } from '../../../../shared/database/sql-literals'
import type { DumpStatement } from './dump-output'

// MySQL's SHOW CREATE output for views, triggers and routines, made into statements that
// rebuild each one as it was: in the session it was created in.

type ShowCreateRow = Record<string, unknown> | undefined

const literal = (value: string): string => sqlLiteral(value, false, 'mysql')

// Why strip DEFINER: loading as another account would otherwise need SUPER to keep it.
export function withoutDefiner(sql: string): string {
  return sql.replace(
    /\sDEFINER\s*=\s*(`[^`]*`|'[^']*'|"[^"]*"|\S+)@(`[^`]*`|'[^']*'|"[^"]*"|\S+)/i,
    ''
  )
}

export function createColumn(row: ShowCreateRow, prefix: string): string {
  const entry = Object.entries(row ?? {}).find(([key]) => key.startsWith(prefix))
  if (typeof entry?.[1] !== 'string') {
    throw new Error(
      'The server didn’t return a definition; the user may lack the privilege to see it.'
    )
  }
  return entry[1]
}

/** The session an object was created in, as SHOW CREATE reports it. */
export type CreationContext = {
  /** Null for a view, which keeps none. */
  sqlMode: string | null
  characterSetClient: string
  collationConnection: string
  /** The database's default collation then; null for a view, which keeps none. */
  databaseCollation: string | null
}

export function creationContext(row: ShowCreateRow): CreationContext {
  const text = (key: string): string | null => {
    const value = row?.[key]
    return typeof value === 'string' ? value : null
  }
  const characterSetClient = text('character_set_client')
  const collationConnection = text('collation_connection')
  if (!characterSetClient || !collationConnection) {
    throw new Error('The server didn’t say which character set a definition was written in.')
  }
  return {
    sqlMode: text('sql_mode'),
    characterSetClient,
    collationConnection,
    databaseCollation: text('Database Collation')
  }
}

/** ALTER DATABASE around a create whose database's default collation differs from today's. */
function databaseSwitch(
  context: CreationContext,
  schemaCollation: string | null,
  notes: string[]
): { before: DumpStatement[]; after: DumpStatement[] } {
  const then = context.databaseCollation
  if (
    !then ||
    !schemaCollation ||
    then === schemaCollation ||
    !/^\w+$/.test(then + schemaCollation)
  ) {
    return { before: [], after: [] }
  }
  const note = `Some triggers or routines were created while their database’s default collation was not today’s; the dump switches the loading database to theirs around each and then to ${schemaCollation}, the source database’s.`
  if (!notes.includes(note)) {
    notes.push(note)
  }
  return {
    before: [{ sql: `ALTER DATABASE COLLATE ${then}` }],
    after: [{ sql: `ALTER DATABASE COLLATE ${schemaCollation}` }]
  }
}

/**
 * `create` in the session it was created in, and the session put back after. Its sql_mode
 * decides how its text reads (ANSI_QUOTES, NO_BACKSLASH_ESCAPES), its character sets how its
 * string literals do, and its database's default collation types its character variables.
 * `schemaCollation` is the source database's default collation now, which the loading
 * database is set back to after a switch, as mysqldump does.
 */
export function inCreationContext(
  label: string,
  create: DumpStatement,
  context: CreationContext,
  schemaCollation: string | null,
  notes: string[]
): DumpStatement[] {
  // Why: the dump is UTF-8, so text in another character set would load as other characters.
  const utf8 = /^utf8/i.test(context.characterSetClient) || !/[\u0080-\uffff]/.test(create.sql)
  const client = utf8 ? context.characterSetClient : 'utf8mb4'
  if (!utf8) {
    notes.push(
      `${label} was written in ${context.characterSetClient}; it is loaded from the dump’s UTF-8 as utf8mb4, which keeps its text, so its character_set_client becomes utf8mb4.`
    )
  }
  const settings: [string, string][] = [
    ...(context.sqlMode === null ? [] : [['SQL_MODE', context.sqlMode] satisfies [string, string]]),
    ['CHARACTER_SET_CLIENT', client],
    ['CHARACTER_SET_RESULTS', client],
    ['COLLATION_CONNECTION', context.collationConnection]
  ]
  const saved = (name: string): string => `@ORCA_SAVED_${name}`
  const save = settings.map(([name]) => `${saved(name)} = @@${name}`)
  const set = settings.map(([name, value]) => `${name} = ${literal(value)}`)
  const { before, after } = databaseSwitch(context, schemaCollation, notes)
  return [
    { sql: `SET ${[...save, ...set].join(', ')}` },
    ...before,
    create,
    ...after,
    { sql: `SET ${settings.map(([name]) => `${name} = ${saved(name)}`).join(', ')}` }
  ]
}

const WRITTEN_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "''",
  '\n': '\\n',
  '\r': '\\r'
}

/**
 * A routine's CREATE with its COMMENT written for NO_BACKSLASH_ESCAPES, the mode it loads in.
 * SHOW CREATE writes the comment with backslash escapes whatever the mode, which that mode
 * would keep as written. Null when the comment isn't found as SHOW CREATE writes it.
 */
export function commentForNoBackslashEscapes(create: string, comment: string): string | null {
  if (!/[\\\n\r]/.test(comment)) {
    return create
  }
  const written = `COMMENT '${comment.replace(/[\\'\n\r]/g, (char) => WRITTEN_ESCAPES[char] ?? char)}'`
  const at = create.indexOf(written)
  if (at === -1) {
    return null
  }
  const plain = `COMMENT '${comment.replaceAll("'", "''")}'`
  return `${create.slice(0, at)}${plain}${create.slice(at + written.length)}`
}
