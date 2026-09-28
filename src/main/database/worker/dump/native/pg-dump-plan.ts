import { majorVersion } from './native-dump-tools'
import {
  perTableSnapshotNote,
  type NativeDumpPlan,
  type NativePlanInput,
  type NativeRun
} from './native-dump-plan'

// Why cleared: the user's own PG* variables would silently override what the connection says.
const CONTROLLED_ENV = new Set([
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGSERVICE',
  'PGOPTIONS',
  'PGSSLMODE',
  'PGPASSWORD',
  'PGCONNECT_TIMEOUT',
  'PGAPPNAME'
])

/** An exact-match pg_dump pattern: inside double quotes nothing is a wildcard. */
function pattern(schema: string, name?: string): string {
  const quote = (part: string): string => `"${part.replaceAll('"', '""')}"`
  return name === undefined ? quote(schema) : `${quote(schema)}.${quote(name)}`
}

/** A conninfo value, so a database name holding `=` isn't read as a connection string. */
function conninfoValue(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/**
 * Drops the selected tables' foreign keys before a per-table setup file's DROP TABLEs: pg_dump
 * drops them with the rest of post-data, which that file doesn't hold.
 */
function dropForeignKeys(tables: readonly { schema: string; name: string }[]): string {
  const relations = tables
    .map((table) => `to_regclass('${pattern(table.schema, table.name).replaceAll("'", "''")}')`)
    .join(', ')
  return `DO $orca$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT conrelid::regclass AS relation, conname FROM pg_catalog.pg_constraint
    WHERE contype = 'f' AND conrelid = ANY (ARRAY[${relations}]::oid[])
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target.relation, target.conname);
  END LOOP;
END
$orca$;

`
}

function pgEnv({ target }: NativePlanInput): NodeJS.ProcessEnv {
  const { connection, password } = target
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !CONTROLLED_ENV.has(key))),
    PGSSLMODE: connection.sslMode,
    PGAPPNAME: 'Orca',
    PGCONNECT_TIMEOUT: '15',
    // Why: the server refuses writes in this session, as it does in every other Orca session.
    PGOPTIONS: '-c default_transaction_read_only=on',
    ...(password === null ? {} : { PGPASSWORD: password }),
    // Through a tunnel: dial the local end, but check TLS against the real server's name.
    ...(connection.tlsServerName ? { PGHOSTADDR: connection.host } : {})
  }
}

/** pg_dump runs for a request: one for a single file; pre-data, a run per table, post-data otherwise. */
export function pgDumpPlan(input: NativePlanInput): NativeDumpPlan {
  const { tool, target, request } = input
  const { connection } = target
  const { options } = request
  const notes: string[] = []
  const withData = options.contents !== 'structure'
  const withStructure = options.contents !== 'data'
  const complete = new Set(request.completeSchemas ?? [])
  const schemas = [...new Set(request.objects.map((object) => object.schema))]
  const partial = request.objects.filter((object) => !complete.has(object.schema))
  const partialRelations = partial.filter((object) => object.kind !== 'routine')
  const skippedRoutines = partial.filter((object) => object.kind === 'routine')
  const tables = request.objects.filter((object) => object.kind === 'table')
  const selectors = [
    ...schemas
      .filter((schema) => complete.has(schema))
      .map((schema) => `--schema=${pattern(schema)}`),
    ...partialRelations.map((object) => `--table=${pattern(object.schema, object.name)}`)
  ]
  if (selectors.length === 0) {
    throw new Error(
      'pg_dump can’t dump single routines. Select their whole schema, or use Orca’s built-in dump.'
    )
  }
  if (skippedRoutines.length > 0) {
    notes.push(
      `pg_dump picks whole schemas or single tables, so these routines are not in the dump: ${skippedRoutines.map((routine) => routine.name).join(', ')}.`
    )
  }
  if (partialRelations.length > 0) {
    notes.push(
      'pg_dump leaves out the types and functions that single tables use (an enum column’s type, a default’s function); select the whole schema to include them.'
    )
  }

  const database = request.database ?? (connection.database || undefined)
  const connect = [
    `--host=${connection.tlsServerName ?? connection.host}`,
    `--port=${connection.port}`,
    ...(connection.user ? [`--username=${connection.user}`] : []),
    ...(database ? [`--dbname=dbname=${conninfoValue(database)}`] : []),
    '--no-password',
    '--format=plain',
    '--encoding=UTF8',
    // Like Orca's own dump: the file loads as whoever runs it.
    '--no-owner',
    '--no-privileges'
  ]
  const batched = options.rowsPerInsert > 1 && majorVersion(tool.version) >= 12
  if (withData && options.rowsPerInsert > 1 && !batched) {
    notes.push(
      `pg_dump ${tool.version} writes one row per INSERT; rows per INSERT needs pg_dump 12.`
    )
  }
  const rows = withData
    ? [batched ? `--rows-per-insert=${options.rowsPerInsert}` : '--inserts']
    : []
  const clean = withStructure && options.dropExisting ? ['--clean', '--if-exists'] : []
  const disableTriggers = options.contents === 'data' && options.disableForeignKeys
  if (disableTriggers) {
    notes.push(
      'pg_dump’s --disable-triggers switches foreign key checks off while loading; that takes a superuser.'
    )
  }
  const triggers = disableTriggers ? ['--disable-triggers'] : []

  if (options.layout === 'single-file') {
    const contents =
      options.contents === 'structure'
        ? ['--schema-only']
        : options.contents === 'data'
          ? ['--data-only']
          : []
    return plan(input, notes, [
      {
        label: database ?? 'dump',
        args: [...connect, ...contents, ...rows, ...clean, ...triggers, ...selectors],
        prelude: '',
        tables: tables.length
      }
    ])
  }

  notes.push(perTableSnapshotNote(tool))
  const runs: NativeRun[] = []
  if (withStructure) {
    runs.push({
      label: 'setup',
      args: [...connect, '--section=pre-data', ...clean, ...selectors],
      prelude: clean.length > 0 && tables.length > 0 ? dropForeignKeys(tables) : '',
      tables: 0
    })
  }
  if (withData) {
    for (const table of tables) {
      runs.push({
        label: `${table.schema}.${table.name}`,
        args: [
          ...connect,
          '--section=data',
          ...rows,
          ...triggers,
          `--table=${pattern(table.schema, table.name)}`
        ],
        prelude: '',
        tables: 1
      })
    }
  }
  // Whole schemas can hold sequences no table owns; their values are data too.
  const sequenceValues = withData && complete.size > 0
  const finish = [...(sequenceValues ? ['data'] : []), ...(withStructure ? ['post-data'] : [])]
  if (finish.length > 0) {
    runs.push({
      label: 'finish',
      args: [
        ...connect,
        ...finish.map((section) => `--section=${section}`),
        ...(sequenceValues
          ? tables.map((table) => `--exclude-table-data=${pattern(table.schema, table.name)}`)
          : []),
        ...selectors
      ],
      prelude: '',
      tables: 0
    })
  }
  return plan(input, notes, runs)
}

function plan(input: NativePlanInput, notes: string[], runs: NativeRun[]): NativeDumpPlan {
  return {
    tool: input.tool,
    env: pgEnv(input),
    runs,
    notes,
    withoutTls: null,
    cleanup: async () => undefined
  }
}
