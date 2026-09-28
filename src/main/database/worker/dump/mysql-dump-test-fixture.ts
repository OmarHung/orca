import mysql from 'mysql2/promise'
import type { DatabaseDumpObject } from '../../../../shared/database/database-dump-types'

// Test-only: the MySQL/MariaDB dump fixture both the built-in and the mysqldump tests restore.

export const fixture = (database: string): string[] => [
  `create database ${database}`,
  `use ${database}`,
  "set session sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES'",
  `create table people (
     id int auto_increment primary key,
     name varchar(100) not null comment 'what they''re called',
     mood enum('ok', 'meh', 'it''s') null, tags set('a', 'b') null, data json null,
     photo blob null, amount decimal(30, 10) null, born date null, seen timestamp(6) null,
     flags bit(3) null, big bigint unsigned null, doubled decimal(31, 10) generated always as (amount * 2) virtual)
   comment 'People, it''s \\\\ 50% 中文 🎉'`,
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

/**
 * Objects whose meaning hangs on the session they were made in: how their text reads under
 * ANSI_QUOTES and NO_BACKSLASH_ESCAPES, their literals' collation, and a routine made before
 * the database's default collation changed. The built-in dump's own; mysqldump's output
 * alters the source database by name around such a routine.
 */
export const contextFixture = (database: string): string[] => [
  `use ${database}`,
  'create table notes (id int primary key, body varchar(60) null)',
  "set session sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES,STRICT_ALL_TABLES'",
  `create function "quoted"("value" varchar(20)) returns varchar(60) deterministic
     comment 'it''s c:\\dir' return concat('a\\b|', "value")`,
  `create procedure "path_of"() select 'x\\y' as "path"`,
  `create trigger "notes_tab" before insert on "notes" for each row begin
     set new."body" = concat(new."body", '\\t'); set new."id" = new."id";
   end`,
  "set session sql_mode = 'STRICT_TRANS_TABLES'",
  'set session collation_connection = latin1_german2_ci',
  "create function literal_collation() returns varchar(60) deterministic return collation('x')",
  // Why a bare literal: a view keeps no sql_mode, and collation()'s nullability follows it.
  "create view literal_view as select 'x' as c",
  'set names utf8mb4',
  `create function local_collation() returns varchar(60) deterministic
     begin declare v varchar(10) default 'a'; return collation(v); end`,
  `alter database ${database} collate utf8mb4_bin`
]

export function contextObjects(database: string): DatabaseDumpObject[] {
  const routine = (name: string, routineKind: 'function' | 'procedure'): DatabaseDumpObject => ({
    kind: 'routine',
    schema: database,
    name,
    identity: name,
    routineKind
  })
  return [
    { kind: 'table', schema: database, name: 'notes' },
    { kind: 'view', schema: database, name: 'literal_view' },
    routine('quoted', 'function'),
    routine('path_of', 'procedure'),
    routine('literal_collation', 'function'),
    routine('local_collation', 'function')
  ]
}

/** What the context objects do when used; each use leaves the database as it found it. */
export async function contextBehaviour(url: string, database: string): Promise<unknown> {
  const client = await mysqlAt(url, database)
  try {
    const [values] = await client.query(
      `select quoted('z') as quoted, literal_collation() as literal, local_collation() as local,
              (select collation(c) from literal_view) as view`
    )
    const [called] = await client.query('call path_of()')
    const path = Array.isArray(called) ? called[0] : called
    await client.query("insert into notes values (1, 'n')")
    const [note] = await client.query('select body from notes where id = 1')
    await client.query('delete from notes where id = 1')
    return { values, path, note }
  } finally {
    await client.end()
  }
}

export function mysqlAt(url: string, database: string): Promise<mysql.Connection> {
  const parsed = new URL(url)
  return mysql.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    timezone: 'Z'
  })
}

/** Every object the fixture makes in `database`. */
export function dumpObjects(database: string): DatabaseDumpObject[] {
  return [
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
}

export async function snapshot(url: string, database: string): Promise<Record<string, unknown>> {
  const client = await mysqlAt(url, database)
  try {
    const result: Record<string, unknown> = {}
    for (const name of ['people', 'orders', 'a', 'b', 'people_view', 'people_view_ids']) {
      const [rows] = await client.query(`select * from \`${name}\` order by 1`)
      result[name] = rows
    }
    const [tables] = await client.query(
      `select TABLE_NAME, AUTO_INCREMENT, TABLE_COMMENT from information_schema.TABLES
       where TABLE_SCHEMA = ? and TABLE_TYPE = 'BASE TABLE' order by TABLE_NAME`,
      [database]
    )
    result.tables = tables
    const [columns] = await client.query(
      `select TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
       from information_schema.COLUMNS where TABLE_SCHEMA = ? order by TABLE_NAME, ORDINAL_POSITION`,
      [database]
    )
    result.columns = columns
    // Each stored object with the session it was made in, which decides what its text means.
    const [routines] = await client.query(
      `select ROUTINE_NAME, ROUTINE_TYPE, SQL_MODE, CHARACTER_SET_CLIENT, COLLATION_CONNECTION,
              DATABASE_COLLATION, ROUTINE_COMMENT, ROUTINE_DEFINITION
       from information_schema.ROUTINES where ROUTINE_SCHEMA = ? order by 1`,
      [database]
    )
    result.routines = routines
    const [triggers] = await client.query(
      `select TRIGGER_NAME, SQL_MODE, CHARACTER_SET_CLIENT, COLLATION_CONNECTION,
              DATABASE_COLLATION, ACTION_STATEMENT
       from information_schema.TRIGGERS where TRIGGER_SCHEMA = ? order by 1`,
      [database]
    )
    result.triggers = triggers
    const [views] = await client.query(
      `select TABLE_NAME, CHARACTER_SET_CLIENT, COLLATION_CONNECTION
       from information_schema.VIEWS where TABLE_SCHEMA = ? order by 1`,
      [database]
    )
    result.views = views
    return result
  } finally {
    await client.end()
  }
}

export const SERVERS = [
  { label: 'MySQL', url: process.env.ORCA_TEST_MYSQL_URL },
  { label: 'MariaDB', url: process.env.ORCA_TEST_MARIADB_URL }
]
