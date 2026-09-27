import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  DatabaseConnectionDraft,
  DatabaseDriver
} from '../../../shared/database/database-connection-types'
import { serverConnectionFromUrl } from './database-worker-test-harness'

// Test-only: the same conformance suite runs against every driver with its own SQL.

export type DriverFixture = {
  label: string
  driver: DatabaseDriver
  /** Null skips the suite (the server's URL env var is unset). */
  open: () => { connection: DatabaseConnectionDraft; password: string | null } | null
  /** Namespace holding `people`, `people_view` and `user` (reserved and mixed-case names). */
  schema: string
  /** Where unqualified names resolve for the test URL's user and database. */
  currentSchema: string
  setup: string[]
  teardown: string[]
  /** `people` qualified for use in SQL. */
  table: string
  series: (count: number) => string
  /** Null where the driver can't cancel in-process (SQLite restarts the worker instead). */
  sleep: string | null
  dispose?: () => void
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
const digits = (alias: string): string =>
  `(select 0 d${Array.from({ length: 9 }, (_, i) => ` union all select ${i + 1}`).join('')}) ${alias}`

function serverFixture(
  label: string,
  driver: 'postgres' | 'mysql' | 'sqlserver',
  env: string,
  fields: Omit<DriverFixture, 'label' | 'driver' | 'open'>
): DriverFixture {
  const url = process.env[env]
  return {
    label,
    driver,
    open: () => (url ? serverConnectionFromUrl(driver, url) : null),
    ...fields
  }
}

const postgresSchema = `orca_it_${suffix}`
const mysqlSchema = `orca_it_${suffix}`

function mysqlFixture(label: string, env: string): DriverFixture {
  return serverFixture(label, 'mysql', env, {
    schema: mysqlSchema,
    currentSchema: 'orca_it',
    setup: [
      `create database ${mysqlSchema}`,
      `create table ${mysqlSchema}.people (id int primary key, name varchar(40) not null)`,
      `create view ${mysqlSchema}.people_view as select * from ${mysqlSchema}.people`,
      `create table ${mysqlSchema}.\`user\` (\`order\` int primary key, \`Mixed Case\` varchar(10))`,
      `insert into ${mysqlSchema}.\`user\` values (1, 'a'), (2, null), (3, 'c')`,
      // The index comes first so the foreign key uses it instead of adding its own.
      `create table ${mysqlSchema}.orders (id int auto_increment primary key, person_id int not null, code varchar(20), amount decimal(10,2) not null default 0, unique key orders_code_key (code), index orders_person_idx (person_id), constraint orders_person_fk foreign key (person_id) references ${mysqlSchema}.people (id), constraint orders_amount_check check (amount >= 0))`,
      `create function ${mysqlSchema}.add_one(i int) returns int deterministic return i + 1`,
      `create procedure ${mysqlSchema}.noop() begin end`
    ],
    teardown: [`drop database ${mysqlSchema}`],
    table: `${mysqlSchema}.people`,
    // Why digits: MySQL caps recursive CTEs at 1000 iterations by default.
    series: (count) =>
      `select a.d + 10 * b.d + 100 * c.d + 1000 * e.d + 1 as n from ${digits('a')}, ${digits('b')}, ${digits('c')}, ${digits('e')} where a.d + 10 * b.d + 100 * c.d + 1000 * e.d < ${count} order by n`,
    sleep: 'select sleep(30)'
  })
}

function sqliteFixture(): DriverFixture {
  let dir: string | null = null
  const filePath = (): string => {
    if (!dir) {
      dir = mkdtempSync(join(tmpdir(), 'orca-sqlite-it-'))
      new DatabaseSync(join(dir, 'test.db')).close()
    }
    return join(dir, 'test.db')
  }
  return {
    label: 'SQLite',
    driver: 'sqlite',
    open: () => ({
      connection: { driver: 'sqlite', name: 'sqlite integration', filePath: filePath() },
      password: null
    }),
    schema: 'main',
    currentSchema: 'main',
    setup: [
      'create table people (id integer primary key, name text not null)',
      'create view people_view as select * from people',
      'create table "user" ("order" integer primary key, "Mixed Case" text)',
      `insert into "user" values (1, 'a'), (2, null), (3, 'c')`,
      'create table orders (id integer primary key, person_id integer not null references people (id), code text unique, amount numeric not null default 0 check (amount >= 0))',
      'create index orders_person_idx on orders (person_id)'
    ],
    teardown: [],
    table: 'people',
    series: (count) =>
      `with recursive s(n) as (select 1 union all select n + 1 from s where n < ${count}) select n from s`,
    sleep: null,
    dispose: () => {
      if (dir) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }
}

export const DRIVER_FIXTURES: DriverFixture[] = [
  serverFixture('PostgreSQL', 'postgres', 'ORCA_TEST_POSTGRES_URL', {
    schema: postgresSchema,
    currentSchema: 'public',
    setup: [
      `create schema ${postgresSchema}`,
      `create table ${postgresSchema}.people (id int primary key, name text not null)`,
      `create view ${postgresSchema}.people_view as select * from ${postgresSchema}.people`,
      `create table ${postgresSchema}."user" ("order" int primary key, "Mixed Case" text)`,
      `insert into ${postgresSchema}."user" values (1, 'a'), (2, null), (3, 'c')`,
      `create table ${postgresSchema}.orders (id int generated by default as identity primary key, person_id int not null constraint orders_person_fk references ${postgresSchema}.people (id), code text constraint orders_code_key unique, amount numeric(10,2) not null default 0 constraint orders_amount_check check (amount >= 0))`,
      `create index orders_person_idx on ${postgresSchema}.orders (person_id)`,
      `create function ${postgresSchema}.add_one(i int) returns int language sql immutable as 'select i + 1'`,
      `create procedure ${postgresSchema}.noop() language sql as ''`
    ],
    teardown: [`drop schema ${postgresSchema} cascade`],
    table: `${postgresSchema}.people`,
    series: (count) => `select generate_series(1, ${count}) as n`,
    sleep: 'select pg_sleep(30)'
  }),
  mysqlFixture('MySQL', 'ORCA_TEST_MYSQL_URL'),
  mysqlFixture('MariaDB', 'ORCA_TEST_MARIADB_URL'),
  serverFixture('SQL Server', 'sqlserver', 'ORCA_TEST_SQLSERVER_URL', {
    schema: postgresSchema,
    currentSchema: 'dbo',
    setup: [
      `create schema ${postgresSchema}`,
      `create table ${postgresSchema}.people (id int primary key, name nvarchar(40) not null)`,
      `create view ${postgresSchema}.people_view as select * from ${postgresSchema}.people`,
      `create table ${postgresSchema}.[user] ([order] int primary key, [Mixed Case] nvarchar(10))`,
      `insert into ${postgresSchema}.[user] values (1, 'a'), (2, null), (3, 'c')`,
      `create table ${postgresSchema}.orders (id int identity(1, 1) primary key, person_id int not null constraint orders_person_fk references ${postgresSchema}.people (id), code nvarchar(20) constraint orders_code_key unique, amount decimal(10,2) not null constraint orders_amount_default default 0 constraint orders_amount_check check (amount >= 0))`,
      `create index orders_person_idx on ${postgresSchema}.orders (person_id)`,
      `create function ${postgresSchema}.add_one(@i int) returns int as begin return @i + 1 end`,
      `create procedure ${postgresSchema}.noop as return 0`
    ],
    teardown: [
      `drop procedure ${postgresSchema}.noop`,
      `drop function ${postgresSchema}.add_one`,
      `drop table ${postgresSchema}.orders`,
      `drop table ${postgresSchema}.[user]`,
      `drop view ${postgresSchema}.people_view`,
      `drop table ${postgresSchema}.people`,
      `drop schema ${postgresSchema}`
    ],
    table: `${postgresSchema}.people`,
    series: (count) =>
      `select top (${count}) row_number() over (order by (select null)) as n from sys.all_objects a cross join sys.all_objects b`,
    sleep: "waitfor delay '00:00:30'"
  }),
  sqliteFixture()
]
