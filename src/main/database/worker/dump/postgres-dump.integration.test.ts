import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  DatabaseDumpObject,
  DatabaseDumpOptions
} from '../../../../shared/database/database-dump-types'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { connectPostgresClient } from '../postgres-client-factory'
import { DumpOutput } from './dump-output'
import { runDump } from './dump-runner'
import { PostgresDumpSource } from './postgres-dump-source'

// Opt-in through ORCA_TEST_POSTGRES_URL; the role must be allowed to create a database.

const url = process.env.ORCA_TEST_POSTGRES_URL
const dir = mkdtempSync(join(tmpdir(), 'orca-pg-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const suffix = randomUUID().slice(0, 8)
const schema = `orca_dump_${suffix}`

const FIXTURE = [
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
  'create trigger orders_upper before insert on orders for each row execute function upper_code()'
]

const OBJECTS: DatabaseDumpObject[] = [
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

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 2,
  dropExisting: false
}

/** Every table's rows and every view's rows as text, ordered, for comparing two databases. */
async function snapshot(database: string): Promise<Record<string, unknown>> {
  const target = serverConnectionFromUrl('postgres', url!)
  const client = new pg.Client({
    host: target.connection.driver === 'postgres' ? target.connection.host : '',
    port: target.connection.driver === 'postgres' ? target.connection.port : 0,
    user: target.connection.driver === 'postgres' ? target.connection.user : '',
    password: target.password ?? undefined,
    database
  })
  await client.connect()
  try {
    const result: Record<string, unknown> = {}
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

describe.skipIf(!url)('PostgreSQL dump', () => {
  const target = url ? serverConnectionFromUrl('postgres', url) : null
  const sourceDatabase =
    target?.connection.driver === 'postgres' ? target.connection.database || 'postgres' : 'postgres'
  const restored: string[] = []

  const dump = async (options: Partial<DatabaseDumpOptions>, path: string) => {
    if (target?.connection.driver !== 'postgres') {
      throw new Error('no PostgreSQL target')
    }
    const client = await connectPostgresClient(target.connection, target.password, () => undefined)
    const source = new PostgresDumpSource(client, 170_000)
    try {
      return await runDump({
        source,
        request: { objects: OBJECTS, options: { ...OPTIONS, ...options } },
        output: new DumpOutput(
          options.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
          'postgres'
        ),
        onProgress: () => undefined,
        isCancelled: () => false
      })
    } finally {
      await source.close()
    }
  }

  const restore = async (files: string[]): Promise<string> => {
    const database = `orca_dump_target_${randomUUID().slice(0, 8)}`
    restored.push(database)
    await runAdminSql(target!, [`create database ${database}`])
    for (const file of files) {
      await runAdminSql(target!, [readFileSync(file, 'utf8')], { database })
    }
    return database
  }

  beforeAll(async () => {
    await runAdminSql(target!, FIXTURE)
  })

  afterAll(async () => {
    await runAdminSql(target!, [`drop schema if exists ${schema} cascade`], { ignoreErrors: true })
    for (const database of restored) {
      await runAdminSql(target!, [`drop database if exists ${database} with (force)`], {
        ignoreErrors: true
      })
    }
  })

  it('restores the same tables, rows, sequences, views, routines and triggers', async () => {
    const summary = await dump({}, join(dir, 'all.sql'))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: 10 })
    const database = await restore(summary.files)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })

  it('restores from a file per table, run in name order, with foreign keys left inline', async () => {
    const folder = join(dir, 'per-table')
    const summary = await dump({ layout: 'file-per-table', disableForeignKeys: false }, folder)
    const files = readdirSync(folder)
      .sort()
      .map((name) => join(folder, name))
    expect(files).toEqual(summary.files)
    // a and b reference each other, so their keys still wait for the finish file.
    expect(summary.notes.join(' ')).toMatch(/cycle/)
    const database = await restore(files)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })

  it('exports only rows, loading into the same structure', async () => {
    const structure = await dump({ contents: 'structure' }, join(dir, 'structure.sql'))
    const data = await dump({ contents: 'data' }, join(dir, 'data.sql'))
    expect(readFileSync(data.files[0]!, 'utf8')).not.toMatch(/CREATE TABLE/)
    const database = await restore([...structure.files, ...data.files])
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })
})
