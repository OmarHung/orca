import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import {
  splitSqlBatches,
  splitSqlStatements
} from '../../../shared/database/sql-statement-splitter'
import { runAdminSql } from './database-test-admin'
import {
  createWorkerHarness,
  expectOk,
  onlyRows,
  serverConnectionFromUrl
} from './database-worker-test-harness'
import { postgresTextLiteral } from './dump/postgres-dump-catalog'
import { sqlServerTextLiteral } from './dump/sqlserver-dump-values'

// Opt-in through ORCA_TEST_POSTGRES_URL / ORCA_TEST_SQLSERVER_URL. Show DDL carries comments:
// loading an object's DDL into another schema gives it the same comments.

// Quotes, a backslash, a percent sign, a line break and characters past ASCII.
const COMMENT = "it's \\ 50% 中文 🎉\nnext line"

type Target = { connection: DatabaseConnectionDraft; password: string | null }

/** One statement's rows as JSON text, read on a console of the harness's session. */
async function rowsOf(harness: ReturnType<typeof createWorkerHarness>, sql: string) {
  const result = await expectOk(
    harness.send({ type: 'execute', consoleId: randomUUID(), sql, pageSize: 100 })
  )
  return onlyRows(result).rows
}

async function ddl(harness: ReturnType<typeof createWorkerHarness>, target: DatabaseDdlTarget) {
  return (await expectOk(harness.send({ type: 'ddl', target }))).ddl
}

const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

describe.skipIf(!POSTGRES_URL)('PostgreSQL DDL comments', () => {
  const schema = `orca_ddl_comments_${randomUUID().slice(0, 8)}`
  const copy = `${schema}_copy`
  const harness = createWorkerHarness()
  const server = (): Target => serverConnectionFromUrl('postgres', POSTGRES_URL!)
  const comment = postgresTextLiteral(COMMENT)
  const comments = (inSchema: string) =>
    rowsOf(
      harness,
      `select coalesce(c.relname, p.proname) as object, a.attname as column_name, d.description
       from pg_catalog.pg_description d
       left join pg_catalog.pg_class c
         on d.classoid = 'pg_catalog.pg_class'::regclass and c.oid = d.objoid
       left join pg_catalog.pg_proc p
         on d.classoid = 'pg_catalog.pg_proc'::regclass and p.oid = d.objoid
       left join pg_catalog.pg_attribute a
         on c.oid is not null and a.attrelid = d.objoid and a.attnum = d.objsubid
       where coalesce(c.relnamespace, p.pronamespace) = '${inSchema}'::regnamespace
       order by 1, 2 nulls first`
    )

  beforeAll(async () => {
    await runAdminSql(server(), [
      `create schema ${schema}`,
      `create table ${schema}.people (id int primary key, "Name" text)`,
      `comment on table ${schema}.people is ${comment}`,
      `comment on column ${schema}.people."Name" is ${comment}`,
      `create view ${schema}.people_view as select id, "Name" from ${schema}.people`,
      `comment on view ${schema}.people_view is ${comment}`,
      `comment on column ${schema}.people_view.id is ${comment}`,
      `create materialized view ${schema}.people_count as select count(*) as n from ${schema}.people`,
      `comment on materialized view ${schema}.people_count is ${comment}`,
      `create function ${schema}.add_one(i int) returns int language sql as 'select i + 1'`,
      `comment on function ${schema}.add_one(int) is ${comment}`,
      `create procedure ${schema}.noop() language sql as $$ select 1 $$`,
      `comment on procedure ${schema}.noop() is ${comment}`,
      `create schema ${copy}`
    ])
    await expectOk(harness.send({ type: 'connect', ...server() }))
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
    await runAdminSql(
      server(),
      [`drop schema if exists ${schema} cascade`, `drop schema if exists ${copy} cascade`],
      { ignoreErrors: true }
    )
  })

  it('writes COMMENT ON after each object, and a load of it keeps every comment', async () => {
    const table = await ddl(harness, { kind: 'relation', schema, relation: 'people' })
    expect(table).toContain(`COMMENT ON TABLE ${schema}.people IS ${comment};`)
    expect(table).toContain(`COMMENT ON COLUMN ${schema}.people."Name" IS ${comment};`)
    const texts = [
      table,
      await ddl(harness, { kind: 'relation', schema, relation: 'people_view' }),
      await ddl(harness, { kind: 'relation', schema, relation: 'people_count' })
    ]
    const routines = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'routines', schema } })
    )
    for (const routine of routines.level === 'routines' ? routines.routines : []) {
      texts.push(
        await ddl(harness, {
          kind: 'routine',
          schema,
          identity: routine.identity,
          routineKind: routine.kind
        })
      )
    }
    // Routine bodies hold semicolons, so each text goes to the server whole.
    await runAdminSql(
      server(),
      texts.map((text) => text.replaceAll(`${schema}.`, `${copy}.`))
    )
    const original = await comments(schema)
    expect(original).toHaveLength(7)
    expect(await comments(copy)).toEqual(original)
  })
})

const SQLSERVER_URL = process.env.ORCA_TEST_SQLSERVER_URL

describe.skipIf(!SQLSERVER_URL)('SQL Server DDL descriptions', () => {
  const database = `orca_ddl_comments_${randomUUID().slice(0, 8)}`
  const harness = createWorkerHarness()
  const server = (): Target => serverConnectionFromUrl('sqlserver', SQLSERVER_URL!)
  const inDatabase = (): Target => {
    const target = server()
    if (target.connection.driver !== 'sqlserver') {
      throw new Error('no SQL Server target')
    }
    return { ...target, connection: { ...target.connection, database } }
  }
  const describeAs = (level1: string, name: string, column?: string) =>
    [
      `exec sys.sp_addextendedproperty N'MS_Description', ${sqlServerTextLiteral(COMMENT)}`,
      `N'SCHEMA', N'sales', N'${level1}', N'${name}'`,
      ...(column ? [`N'COLUMN', N'${column}'`] : [])
    ].join(', ')
  const descriptions = (schema: string) =>
    rowsOf(
      harness,
      `select object_name(major_id) as o, col_name(major_id, minor_id) as c,
              cast(value as nvarchar(max)) as v
       from sys.extended_properties
       where class = 1 and name = N'MS_Description' and object_schema_name(major_id) = N'${schema}'
       order by o, minor_id`
    )

  beforeAll(async () => {
    await runAdminSql(server(), [`create database ${database}`])
    await runAdminSql(
      server(),
      [
        'create schema sales',
        'create schema sales_copy',
        'create table sales.people (id int primary key, name nvarchar(50) null)',
        'create view sales.people_view as select id, name from sales.people',
        'create procedure sales.noop as begin set nocount on end',
        'create function sales.add_one(@i int) returns int as begin return @i + 1 end',
        describeAs('TABLE', 'people'),
        describeAs('TABLE', 'people', 'name'),
        describeAs('VIEW', 'people_view'),
        describeAs('VIEW', 'people_view', 'id'),
        describeAs('PROCEDURE', 'noop'),
        describeAs('FUNCTION', 'add_one')
      ],
      { database }
    )
    await expectOk(harness.send({ type: 'connect', ...inDatabase() }))
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
    await runAdminSql(
      server(),
      [
        `alter database ${database} set single_user with rollback immediate`,
        `drop database ${database}`
      ],
      { ignoreErrors: true }
    )
  })

  it('adds MS_Description after each object, and a load of it keeps every description', async () => {
    const table = await ddl(harness, { kind: 'relation', schema: 'sales', relation: 'people' })
    expect(table).toContain(
      `EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = ${sqlServerTextLiteral(COMMENT)}, @level0type = N'SCHEMA', @level0name = N'sales', @level1type = N'TABLE', @level1name = N'people', @level2type = N'COLUMN', @level2name = N'name';`
    )
    const retarget = (text: string) =>
      text.replaceAll('sales.', 'sales_copy.').replaceAll("N'sales'", "N'sales_copy'")
    await runAdminSql(
      inDatabase(),
      splitSqlStatements(retarget(table), 'sqlserver').map((statement) => statement.text)
    )
    const others: DatabaseDdlTarget[] = [
      { kind: 'relation', schema: 'sales', relation: 'people_view' },
      { kind: 'routine', schema: 'sales', identity: 'noop', routineKind: 'procedure' },
      { kind: 'routine', schema: 'sales', identity: 'add_one', routineKind: 'function' }
    ]
    for (const target of others) {
      const text = retarget(await ddl(harness, target))
      // CREATE VIEW, PROCEDURE and FUNCTION must each be alone in a batch.
      await runAdminSql(
        inDatabase(),
        splitSqlBatches(text, 'sqlserver').map((batch) => batch.text)
      )
    }
    const original = await descriptions('sales')
    expect(original).toHaveLength(6)
    expect(await descriptions('sales_copy')).toEqual(original)
  })
})
