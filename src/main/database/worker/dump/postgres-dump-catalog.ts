import type pg from 'pg'
import { qualifiedRelationName, quoteSqlName } from '../../../../shared/database/sql-identifiers'

// What a PostgreSQL table needs before and after it in a dump: its user types and sequences.

const q = (name: string): string => quoteSqlName(name, 'postgres')

export function postgresTextLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

// Array columns count as their element type; a table's own row type is not a user type.
const USER_TYPES_SQL = `
  select distinct t.oid, n.nspname as schema, t.typname as name, t.typtype as kind
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_type used on used.oid = a.atttypid
  join pg_catalog.pg_type t
    on t.oid = case when used.typelem <> 0 and used.typlen = -1 then used.typelem else used.oid end
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  left join pg_catalog.pg_class c on c.oid = t.typrelid
  where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped
    and n.nspname not in ('pg_catalog', 'information_schema')
    and (t.typtype in ('e', 'd') or (t.typtype = 'c' and c.relkind = 'c'))
  order by n.nspname, t.typname`

// Sequences its column defaults call (serial columns and hand-written nextval).
const DEFAULT_SEQUENCES_SQL = `
  select distinct s.oid, n.nspname as schema, s.relname as name
  from pg_catalog.pg_attrdef ad
  join pg_catalog.pg_depend d
    on d.classid = 'pg_catalog.pg_attrdef'::regclass and d.objid = ad.oid
  join pg_catalog.pg_class s on s.oid = d.refobjid and s.relkind = 'S'
  join pg_catalog.pg_namespace n on n.oid = s.relnamespace
  where ad.adrelid = $1::oid
  order by n.nspname, s.relname`

const OWNED_BY_SQL = `
  select a.attname as column
  from pg_catalog.pg_depend d
  join pg_catalog.pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where d.objid = $1::oid and d.refobjid = $2::oid and d.deptype = 'a'`

// Serial and identity sequences alike, so their values can follow the rows.
const TABLE_SEQUENCES_SQL = `
  select distinct pg_catalog.pg_get_serial_sequence($1, a.attname) as sequence
  from pg_catalog.pg_attribute a
  where a.attrelid = $2::oid and a.attnum > 0 and not a.attisdropped
    and pg_catalog.pg_get_serial_sequence($1, a.attname) is not null`

type UserType = { oid: number; schema: string; name: string; kind: string }

async function typeDefinition(client: pg.Client, type: UserType): Promise<string> {
  const name = qualifiedRelationName(type.schema, type.name, 'postgres')
  if (type.kind === 'e') {
    const labels = await client.query<{ label: string }>(
      'select enumlabel as label from pg_catalog.pg_enum where enumtypid = $1::oid order by enumsortorder',
      [type.oid]
    )
    return `CREATE TYPE ${name} AS ENUM (${labels.rows.map((row) => postgresTextLiteral(row.label)).join(', ')})`
  }
  if (type.kind === 'd') {
    const domain = await client.query<{ base: string; not_null: boolean; default: string | null }>(
      `select pg_catalog.format_type(typbasetype, typtypmod) as base, typnotnull as not_null,
              typdefault as default
       from pg_catalog.pg_type where oid = $1::oid`,
      [type.oid]
    )
    const checks = await client.query<{ name: string; definition: string }>(
      `select conname as name, pg_catalog.pg_get_constraintdef(oid, true) as definition
       from pg_catalog.pg_constraint where contypid = $1::oid order by conname`,
      [type.oid]
    )
    const row = domain.rows[0]!
    return [
      `CREATE DOMAIN ${name} AS ${row.base}`,
      ...(row.default ? [`DEFAULT ${row.default}`] : []),
      ...(row.not_null ? ['NOT NULL'] : []),
      ...checks.rows.map((check) => `CONSTRAINT ${q(check.name)} ${check.definition}`)
    ].join(' ')
  }
  const fields = await client.query<{ name: string; type: string }>(
    `select a.attname as name, pg_catalog.format_type(a.atttypid, a.atttypmod) as type
     from pg_catalog.pg_type t join pg_catalog.pg_attribute a on a.attrelid = t.typrelid
     where t.oid = $1::oid and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    [type.oid]
  )
  return `CREATE TYPE ${name} AS (${fields.rows.map((field) => `${q(field.name)} ${field.type}`).join(', ')})`
}

export type PostgresSequenceDefinition = {
  data_type: string
  start_value: string
  min_value: string
  max_value: string
  increment_by: string
  cycle: boolean
  cache_size: string
}

async function readSequence(
  client: pg.Client,
  sequence: { schema: string; name: string }
): Promise<PostgresSequenceDefinition> {
  const result = await client.query<PostgresSequenceDefinition>(
    `select data_type::text as data_type, start_value::text, min_value::text, max_value::text,
            increment_by::text, cycle, cache_size::text
     from pg_catalog.pg_sequences where schemaname = $1 and sequencename = $2`,
    [sequence.schema, sequence.name]
  )
  return result.rows[0]!
}

function sequenceCreate(name: string, sequence: PostgresSequenceDefinition): string {
  return [
    `CREATE SEQUENCE IF NOT EXISTS ${name}`,
    `AS ${sequence.data_type} INCREMENT BY ${sequence.increment_by}`,
    `MINVALUE ${sequence.min_value} MAXVALUE ${sequence.max_value}`,
    `START WITH ${sequence.start_value} CACHE ${sequence.cache_size}`,
    sequence.cycle ? 'CYCLE' : 'NO CYCLE'
  ].join(' ')
}

/** `body` in dollar quotes whose tag it doesn't contain. */
function dollarQuoted(body: string): string {
  let tag = '$orca$'
  for (let attempt = 1; body.includes(tag); attempt += 1) {
    tag = `$orca${attempt}$`
  }
  return `${tag}${body}${tag}`
}

/**
 * Runs before CREATE SEQUENCE IF NOT EXISTS, which keeps a sequence the target already has: one
 * defined otherwise stops the load or, with `dropExisting`, is dropped when nothing else uses it.
 */
export function postgresSequenceGuard(
  name: string,
  sequence: PostgresSequenceDefinition,
  dropExisting: boolean
): string {
  const regclass = `pg_catalog.to_regclass(${postgresTextLiteral(name)})`
  const bigint = (value: string): string => `${postgresTextLiteral(value)}::bigint`
  const dumped = [
    `${postgresTextLiteral(sequence.data_type)}::regtype::oid`,
    bigint(sequence.increment_by),
    bigint(sequence.min_value),
    bigint(sequence.max_value),
    bigint(sequence.cache_size),
    String(sequence.cycle)
  ].join(', ')
  const differs = `EXISTS (SELECT 1 FROM pg_catalog.pg_sequence WHERE seqrelid = ${regclass} AND (seqtypid, seqincrement, seqmin, seqmax, seqcache, seqcycle) IS DISTINCT FROM (${dumped}))`
  // Why USING MESSAGE: RAISE's format string would read a `%` in the name.
  const refuse = (hint: string): string =>
    `RAISE EXCEPTION USING MESSAGE = ${postgresTextLiteral(`Sequence ${name} already exists with a definition other than the dumped one.`)}, HINT = ${postgresTextLiteral(hint)};`
  const onDifference = dropExisting
    ? `IF EXISTS (SELECT 1 FROM pg_catalog.pg_depend WHERE refclassid = 'pg_catalog.pg_class'::regclass AND refobjid = ${regclass} AND deptype = 'n') THEN ${refuse("Other objects use it, so the dump can't replace it.")} END IF; DROP SEQUENCE ${name};`
    : refuse('Drop it, or dump again dropping existing objects first.')
  return `DO ${dollarQuoted(`BEGIN IF ${differs} THEN ${onDifference} END IF; END`)}`
}

/** Types and sequences `oid`'s columns need, and the ALTER SEQUENCE … OWNED BY that ties them. */
export async function postgresTableRequirements(
  client: pg.Client,
  table: { oid: number; sqlName: string },
  dropExisting: boolean
): Promise<{ requires: string[]; ownedBy: string[] }> {
  const types = await client.query<UserType>(USER_TYPES_SQL, [table.oid])
  const sequences = await client.query<{ oid: number; schema: string; name: string }>(
    DEFAULT_SEQUENCES_SQL,
    [table.oid]
  )
  const requires: string[] = []
  for (const type of types.rows) {
    requires.push(await typeDefinition(client, type))
  }
  const ownedBy: string[] = []
  for (const sequence of sequences.rows) {
    const name = qualifiedRelationName(sequence.schema, sequence.name, 'postgres')
    const definition = await readSequence(client, sequence)
    requires.push(
      postgresSequenceGuard(name, definition, dropExisting),
      sequenceCreate(name, definition)
    )
    const owner = await client.query<{ column: string }>(OWNED_BY_SQL, [sequence.oid, table.oid])
    const column = owner.rows[0]?.column
    if (column) {
      ownedBy.push(`ALTER SEQUENCE ${name} OWNED BY ${table.sqlName}.${q(column)}`)
    }
  }
  return { requires, ownedBy }
}

/** setval for each sequence behind the table's serial and identity columns, as it stands now. */
export async function postgresSequenceValues(
  client: pg.Client,
  table: { oid: number; sqlName: string }
): Promise<string[]> {
  const sequences = await client.query<{ sequence: string }>(TABLE_SEQUENCES_SQL, [
    table.sqlName,
    table.oid
  ])
  const statements: string[] = []
  for (const { sequence } of sequences.rows) {
    const value = await client.query<{ last_value: string; is_called: boolean }>(
      `select last_value::text, is_called from ${sequence}`
    )
    const row = value.rows[0]
    if (row) {
      statements.push(
        `SELECT pg_catalog.setval(${postgresTextLiteral(sequence)}, ${row.last_value}, ${row.is_called})`
      )
    }
  }
  return statements
}
