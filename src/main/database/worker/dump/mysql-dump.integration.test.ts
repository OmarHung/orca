import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  DatabaseDumpObject,
  DatabaseDumpOptions
} from '../../../../shared/database/database-dump-types'
import { splitSqlStatements } from '../../../../shared/database/sql-statement-splitter'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { connectMysqlClient } from '../mysql-client-factory'
import { DumpOutput } from './dump-output'
import { runDump } from './dump-runner'
import { MysqlDumpSource } from './mysql-dump-source'

// Opt-in through ORCA_TEST_MYSQL_URL / ORCA_TEST_MARIADB_URL; the user must create databases.

const dir = mkdtempSync(join(tmpdir(), 'orca-mysql-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fixture = (database: string): string[] => [
  `create database ${database}`,
  `use ${database}`,
  "set session sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES'",
  `create table people (
     id int auto_increment primary key, name varchar(100) not null,
     mood enum('ok', 'meh', 'it''s') null, tags set('a', 'b') null, data json null,
     photo blob null, amount decimal(30, 10) null, born date null, seen timestamp(6) null,
     flags bit(3) null, big bigint unsigned null, doubled decimal(31, 10) generated always as (amount * 2) virtual)`,
  `create table orders (
     id int auto_increment primary key, person_id int not null, code varchar(20) null unique,
     constraint orders_person_fk foreign key (person_id) references people (id))`,
  'create table a (id int primary key, b_id int null)',
  'create table b (id int primary key, a_id int null, foreign key (a_id) references a (id))',
  'alter table a add constraint a_b_fk foreign key (b_id) references b (id)',
  `insert into people (id, name, mood, tags, data, photo, amount, born, seen, flags, big) values
     (0, 'Zero', null, '', null, null, 0, null, null, null, null),
     (1, 'Ada', 'it''s', 'a,b', '{"k": [1, 2.5, null], "s": "q\\\\"uote"}', x'00ff10', 12345678901234567890.1234567891, '2024-02-29', '2026-09-28 12:34:56.123456', b'101', 18446744073709551615),
     (2, 'Bob''s\\nline\\\\slash 中文 🎉', null, 'b', null, x'', -0.0000000001, '1000-01-01', null, b'000', 0)`,
  "insert into orders (person_id, code) values (1, 'a1'), (2, 'b''2'), (1, null)",
  'insert into a values (1, null), (2, null)',
  'insert into b values (10, 1), (20, 2)',
  'update a set b_id = 10 where id = 1',
  'create view people_view as select id, name from people',
  'create view people_view_ids as select id from people_view',
  'create function add_one(i int) returns int deterministic return i + 1',
  'create procedure two_sets() begin select 1; select 2; end',
  'create trigger orders_upper before insert on orders for each row set new.code = upper(new.code)'
]

async function snapshot(url: string, database: string): Promise<Record<string, unknown>> {
  const parsed = new URL(url)
  const client = await mysql.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    timezone: 'Z'
  })
  try {
    const result: Record<string, unknown> = {}
    for (const name of ['people', 'orders', 'a', 'b', 'people_view', 'people_view_ids']) {
      const [rows] = await client.query(`select * from \`${name}\` order by 1`)
      result[name] = rows
    }
    const [tables] = await client.query(
      `select TABLE_NAME, AUTO_INCREMENT from information_schema.TABLES
       where TABLE_SCHEMA = ? and TABLE_TYPE = 'BASE TABLE' order by TABLE_NAME`,
      [database]
    )
    result.tables = tables
    const [columns] = await client.query(
      `select TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       from information_schema.COLUMNS where TABLE_SCHEMA = ? order by TABLE_NAME, ORDINAL_POSITION`,
      [database]
    )
    result.columns = columns
    const [routines] = await client.query(
      'select ROUTINE_NAME, ROUTINE_TYPE from information_schema.ROUTINES where ROUTINE_SCHEMA = ? order by 1',
      [database]
    )
    result.routines = routines
    const [triggers] = await client.query(
      'select TRIGGER_NAME from information_schema.TRIGGERS where TRIGGER_SCHEMA = ?',
      [database]
    )
    result.triggers = triggers
    return result
  } finally {
    await client.end()
  }
}

const SERVERS = [
  { label: 'MySQL', url: process.env.ORCA_TEST_MYSQL_URL },
  { label: 'MariaDB', url: process.env.ORCA_TEST_MARIADB_URL }
]

describe.each(SERVERS)('$label dump', ({ url }) => {
  const database = `orca_dump_${randomUUID().slice(0, 8)}`
  const target = url ? serverConnectionFromUrl('mysql', url) : null
  const created: string[] = [database]
  const objects: DatabaseDumpObject[] = [
    ...['people', 'orders', 'a', 'b'].map((name) => ({
      kind: 'table' as const,
      schema: database,
      name
    })),
    { kind: 'view', schema: database, name: 'people_view_ids' },
    { kind: 'view', schema: database, name: 'people_view' },
    {
      kind: 'routine',
      schema: database,
      name: 'add_one',
      identity: 'add_one',
      routineKind: 'function'
    },
    {
      kind: 'routine',
      schema: database,
      name: 'two_sets',
      identity: 'two_sets',
      routineKind: 'procedure'
    }
  ]
  const options: DatabaseDumpOptions = {
    contents: 'structure-and-data',
    disableForeignKeys: true,
    layout: 'single-file',
    rowsPerInsert: 2,
    dropExisting: false
  }

  const dump = async (changes: Partial<DatabaseDumpOptions>, path: string) => {
    if (target?.connection.driver !== 'mysql') {
      throw new Error('no MySQL target')
    }
    const client = await connectMysqlClient(target.connection, target.password, () => undefined)
    const source = new MysqlDumpSource(client)
    try {
      return await runDump({
        source,
        request: { objects, options: { ...options, ...changes } },
        output: new DumpOutput(
          changes.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
          'mysql'
        ),
        onProgress: () => undefined,
        isCancelled: () => false
      })
    } finally {
      await source.close()
    }
  }

  /** Loads dump files into a new database, statement by statement as a client would. */
  const restore = async (files: string[]): Promise<string> => {
    const into = `orca_dump_target_${randomUUID().slice(0, 8)}`
    created.push(into)
    await runAdminSql(target!, [`create database ${into}`])
    const statements = files.flatMap((file) =>
      splitSqlStatements(readFileSync(file, 'utf8'), 'mysql').map((statement) => statement.text)
    )
    await runAdminSql(target!, statements, { database: into })
    return into
  }

  beforeAll(async () => {
    if (target) {
      await runAdminSql(target, fixture(database))
    }
  })

  afterAll(async () => {
    if (target) {
      await runAdminSql(
        target,
        created.map((name) => `drop database if exists ${name}`),
        { ignoreErrors: true }
      )
    }
  })

  it.skipIf(!url)('restores the same tables, rows, views, routines and triggers', async () => {
    const summary = await dump({}, join(dir, `${database}.sql`))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: 10 })
    const into = await restore(summary.files)
    expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
  })

  it.skipIf(!url)('restores from a file per table with foreign key checks left on', async () => {
    const folder = join(dir, `${database}-files`)
    const summary = await dump(
      { layout: 'file-per-table', disableForeignKeys: false, dropExisting: true },
      folder
    )
    expect(
      readdirSync(folder)
        .sort()
        .map((name) => join(folder, name))
    ).toEqual(summary.files)
    const into = await restore(summary.files)
    expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
  })
})
