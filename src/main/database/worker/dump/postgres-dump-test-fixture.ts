import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type {
  DatabaseDumpObject,
  DatabaseDumpOptions
} from '../../../../shared/database/database-dump-types'
import { serverConnectionFromUrl } from '../database-worker-test-harness'

// Test-only: the PostgreSQL dump fixture both the built-in and the pg_dump tests restore.

export const url = process.env.ORCA_TEST_POSTGRES_URL
export const suffix = randomUUID().slice(0, 8)
export const schema = `orca_dump_${suffix}`

export const FIXTURE = [
  `create schema ${schema}`,
  `set search_path to ${schema}`,
  "create type mood as enum ('ok', 'meh', 'it''s fine')",
  'create domain positive_int as int check (value > 0)',
  `create table people (
     id serial primary key, name text not null, mood mood, tags text[], data jsonb, photo bytea,
     amount numeric(30, 10), born date, seen timestamptz)`,
  `create table orders (
     id int generated always as identity primary key,
     person_id int not null references people (id), total positive_int,
     code text unique, doubled int generated always as (total * 2) stored)`,
  'create index orders_person_idx on orders (person_id)',
  'create table a (id int primary key, b_id int)',
  'create table b (id int primary key, a_id int references a (id))',
  'alter table a add constraint a_b_fk foreign key (b_id) references b (id)',
  `insert into people (name, mood, tags, data, photo, amount, born, seen) values
     ('Ada', 'it''s fine', '{"x,y","q\\"uote"}', '{"k": [1, 2.5e30, null]}', '\\x00ff10', 12345678901234567890.1234567891, '2024-02-29', '2026-09-28 12:34:56.123456+08'),
     ('Bob''s\nline\\slash 中文 🎉', null, '{}', null, '\\x', -0.0000000001, null, null),
     ('Cy', 'ok', null, '"just text"', null, 0, '0001-01-01', 'infinity')`,
  "insert into orders (person_id, total, code) values (1, 3, 'A1'), (2, 5, 'B''2'), (1, 7, null)",
  'insert into a values (1, null), (2, null)',
  'insert into b values (10, 1), (20, 2)',
  'update a set b_id = 10 where id = 1',
  'create view people_view as select id, name from people',
  'create view people_view_ids as select id from people_view',
  `create function add_one(i int) returns int language sql as 'select i + 1'`,
  `create function upper_code() returns trigger language plpgsql as $$
     begin new.code := upper(new.code); return new; end $$`,
  'create trigger orders_upper before insert on orders for each row execute function upper_code()',
  // Comments with quotes, a backslash, a percent sign, a line break and characters past ASCII.
  "comment on table people is 'People, it''s \\ 50% 中文 🎉\nnext line'",
  "comment on column people.name is 'what they''re called'",
  "comment on column orders.doubled is 'twice the total'",
  "comment on view people_view is 'just names'",
  "comment on function add_one(int) is 'adds one'"
]

export const OBJECTS: DatabaseDumpObject[] = [
  ...['people', 'orders', 'a', 'b'].map((name) => ({ kind: 'table' as const, schema, name })),
  { kind: 'view', schema, name: 'people_view_ids' },
  { kind: 'view', schema, name: 'people_view' },
  {
    kind: 'routine',
    schema,
    name: 'add_one',
    identity: `${schema}.add_one(integer)`,
    routineKind: 'function'
  },
  {
    kind: 'routine',
    schema,
    name: 'upper_code',
    identity: `${schema}.upper_code()`,
    routineKind: 'function'
  }
]

export const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 2,
  dropExisting: false
}

// Every comment on the schema's tables, views, columns and routines.
const COMMENTS_SQL = `
  select coalesce(c.relname, p.proname) as object, a.attname as column_name, d.description
  from pg_catalog.pg_description d
  left join pg_catalog.pg_class c
    on d.classoid = 'pg_catalog.pg_class'::regclass and c.oid = d.objoid
  left join pg_catalog.pg_proc p
    on d.classoid = 'pg_catalog.pg_proc'::regclass and p.oid = d.objoid
  left join pg_catalog.pg_attribute a
    on c.oid is not null and a.attrelid = d.objoid and a.attnum = d.objsubid
  where coalesce(c.relnamespace, p.pronamespace) = $1::regnamespace
  order by 1, 2 nulls first`

const SEQUENCES_SQL = `
  select sequencename, data_type::text, start_value::text, min_value::text, max_value::text,
         increment_by::text, cycle, cache_size::text
  from pg_catalog.pg_sequences where schemaname = $1 order by sequencename`

async function connectTo(database: string): Promise<pg.Client> {
  const target = serverConnectionFromUrl('postgres', url!)
  const client = new pg.Client({
    host: target.connection.driver === 'postgres' ? target.connection.host : '',
    port: target.connection.driver === 'postgres' ? target.connection.port : 0,
    user: target.connection.driver === 'postgres' ? target.connection.user : '',
    password: target.password ?? undefined,
    database
  })
  await client.connect()
  return client
}

/** How each of the fixture schema's sequences in `database` is defined. */
export async function sequenceDefinitions(database: string): Promise<unknown[]> {
  const client = await connectTo(database)
  try {
    return (await client.query(SEQUENCES_SQL, [schema])).rows
  } finally {
    await client.end()
  }
}

/** Every table's rows and every view's rows as text, ordered, for comparing two databases. */
export async function snapshot(database: string): Promise<Record<string, unknown>> {
  const client = await connectTo(database)
  try {
    const result: Record<string, unknown> = {}
    result.sequences = (await client.query(SEQUENCES_SQL, [schema])).rows
    result.comments = (await client.query(COMMENTS_SQL, [schema])).rows
    for (const name of ['people', 'orders', 'a', 'b', 'people_view', 'people_view_ids']) {
      const rows = await client.query(`select t::text from ${schema}.${name} t order by 1`)
      result[name] = rows.rows
    }
    const next = await client.query(`select nextval('${schema}.people_id_seq')::text as v`)
    result.next = next.rows
    const columns = await client.query(
      `select table_name, column_name, data_type, is_nullable, column_default, is_identity, is_generated
       from information_schema.columns where table_schema = $1 order by table_name, ordinal_position`,
      [schema]
    )
    result.columns = columns.rows
    const triggers = await client.query(
      `select tgname from pg_trigger where tgrelid = '${schema}.orders'::regclass and not tgisinternal`
    )
    result.triggers = triggers.rows
    return result
  } finally {
    await client.end()
  }
}
