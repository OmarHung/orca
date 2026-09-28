import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySectionKind
} from '../../../shared/database/database-properties-types'
import { runAdminSql } from './database-test-admin'
import {
  createWorkerHarness,
  expectOk,
  serverConnectionFromUrl
} from './database-worker-test-harness'

// Opt-in through ORCA_TEST_{POSTGRES,MYSQL,MARIADB,SQLSERVER}_URL; SQLite always runs.

type Target = { connection: DatabaseConnectionDraft; password: string | null }

/** One section's properties by key, e.g. `{ engine: 'InnoDB' }`. */
function section(
  properties: DatabaseObjectProperties,
  kind: DatabasePropertySectionKind
): Record<string, string> {
  const found = properties.sections.find((entry) => entry.kind === kind)
  return Object.fromEntries((found?.properties ?? []).map((entry) => [entry.key, entry.value]))
}

function column(properties: DatabaseObjectProperties, name: string) {
  return properties.columns?.find((entry) => entry.name === name)
}

/** Properties read the way the page asks for them, through the worker. */
async function propertiesOf(
  target: Target,
  request: DatabasePropertiesTarget
): Promise<DatabaseObjectProperties> {
  const harness = createWorkerHarness()
  await expectOk(harness.send({ type: 'connect', ...target }))
  try {
    return await expectOk(harness.send({ type: 'properties', target: request }))
  } finally {
    await harness.send({ type: 'close' })
  }
}

describe('SQLite properties', () => {
  let dir = ''
  let target: Target

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-sqlite-props-'))
    const filePath = join(dir, 'shop.db')
    const database = new DatabaseSync(filePath)
    database.exec('pragma page_size = 8192')
    database.exec('pragma user_version = 7')
    database.exec('create table people (id integer primary key, name text not null) strict')
    database.exec('create table tags (name text primary key) without rowid')
    database.exec('create view names as select name from people')
    database.close()
    target = { connection: { driver: 'sqlite', name: 'shop', filePath }, password: null }
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the file’s page size, encoding and version', async () => {
    const server = await propertiesOf(target, { kind: 'server' })
    expect(section(server, 'server').version).toMatch(/^3\./)
    const main = section(await propertiesOf(target, { kind: 'schema', schema: 'main' }), 'database')
    expect(main).toMatchObject({ pageSize: '8192', encoding: 'UTF-8', userVersion: '7' })
    expect(main.file).toMatch(/shop\.db$/)
  })

  it('tells STRICT and WITHOUT ROWID tables apart, and lists columns', async () => {
    const people = await propertiesOf(target, {
      kind: 'relation',
      schema: 'main',
      relation: 'people'
    })
    expect(section(people, 'table')).toMatchObject({ strict: 'true', withoutRowid: 'false' })
    expect(column(people, 'name')).toMatchObject({ dataType: 'TEXT', nullable: false })
    const tags = await propertiesOf(target, { kind: 'relation', schema: 'main', relation: 'tags' })
    expect(section(tags, 'table')).toMatchObject({ withoutRowid: 'true' })
    const names = await propertiesOf(target, {
      kind: 'relation',
      schema: 'main',
      relation: 'names'
    })
    expect(section(names, 'view').type).toBe('view')
  })
})

describe.each([
  { label: 'MySQL', url: process.env.ORCA_TEST_MYSQL_URL },
  { label: 'MariaDB', url: process.env.ORCA_TEST_MARIADB_URL }
])('$label properties', ({ url }) => {
  const database = `orca_props_${randomUUID().slice(0, 8)}`
  const at = (): Target => serverConnectionFromUrl('mysql', url!)

  beforeAll(async () => {
    if (!url) {
      return
    }
    await runAdminSql(at(), [
      `create database ${database} character set utf8mb4 collate utf8mb4_unicode_ci`,
      `create table ${database}.people (
         id int auto_increment primary key,
         name varchar(20) character set latin1 collate latin1_german2_ci not null comment 'who'
       ) engine = InnoDB comment = 'the people' auto_increment = 42`,
      `create sql security invoker view ${database}.names as select name from ${database}.people`
    ])
  })

  afterAll(async () => {
    if (url) {
      await runAdminSql(at(), [`drop database if exists ${database}`], { ignoreErrors: true })
    }
  })

  it.skipIf(!url)('reads the server’s and a database’s character set and collation', async () => {
    const server = await propertiesOf(at(), { kind: 'server' })
    expect(Object.keys(section(server, 'server'))).toEqual(
      expect.arrayContaining(['version', 'characterSet', 'collation', 'defaultEngine'])
    )
    const schema = await propertiesOf(at(), { kind: 'schema', schema: database })
    expect(section(schema, 'database')).toMatchObject({
      characterSet: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci'
    })
  })

  it.skipIf(!url)('reads a table’s engine, collation and comment, and its columns’', async () => {
    const people = await propertiesOf(at(), {
      kind: 'relation',
      schema: database,
      relation: 'people'
    })
    expect(section(people, 'table')).toMatchObject({
      engine: 'InnoDB',
      collation: 'utf8mb4_unicode_ci',
      characterSet: 'utf8mb4',
      autoIncrement: '42',
      comment: 'the people'
    })
    expect(column(people, 'name')).toMatchObject({
      dataType: 'varchar(20)',
      nullable: false,
      characterSet: 'latin1',
      collation: 'latin1_german2_ci',
      comment: 'who'
    })
    const names = await propertiesOf(at(), {
      kind: 'relation',
      schema: database,
      relation: 'names'
    })
    expect(section(names, 'view')).toMatchObject({ securityType: 'INVOKER' })
    expect(section(names, 'view').comment).toBeUndefined()
  })
})

const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

describe.skipIf(!POSTGRES_URL)('PostgreSQL properties', () => {
  const schema = `orca_props_${randomUUID().slice(0, 8)}`
  const at = (): Target => serverConnectionFromUrl('postgres', POSTGRES_URL!)
  const databaseName = (): string => {
    const { connection } = at()
    return connection.driver === 'postgres' ? connection.database || 'postgres' : 'postgres'
  }

  beforeAll(async () => {
    await runAdminSql(at(), [
      `create schema ${schema}`,
      `comment on schema ${schema} is 'props schema'`,
      `create unlogged table ${schema}.people (id int primary key, name text collate "C")`,
      `comment on table ${schema}.people is 'the people'`,
      `comment on column ${schema}.people.name is 'who'`,
      `create view ${schema}.names with (security_barrier) as select name from ${schema}.people`
    ])
  })

  afterAll(async () => {
    await runAdminSql(at(), [`drop schema if exists ${schema} cascade`], { ignoreErrors: true })
  })

  it('reads the connection’s database encoding and collation, with the server’s version', async () => {
    const server = await propertiesOf(at(), { kind: 'server' })
    expect(section(server, 'server').version).toMatch(/^\d+/)
    const database = section(server, 'database')
    expect(database.encoding).toBe('UTF8')
    expect(Object.keys(database)).toEqual(
      expect.arrayContaining(['owner', 'collation', 'ctype', 'size'])
    )
    const named = await propertiesOf(at(), { kind: 'database', database: databaseName() })
    expect(section(named, 'database').encoding).toBe('UTF8')
  })

  it('reads a schema’s owner and comment, and a table’s persistence, sizes and columns', async () => {
    const schemaProperties = await propertiesOf(at(), { kind: 'schema', schema })
    expect(section(schemaProperties, 'schema')).toMatchObject({ comment: 'props schema' })
    const people = await propertiesOf(at(), { kind: 'relation', schema, relation: 'people' })
    expect(section(people, 'table')).toMatchObject({
      type: 'table',
      persistence: 'unlogged',
      comment: 'the people'
    })
    expect(Object.keys(section(people, 'table'))).toEqual(
      expect.arrayContaining(['owner', 'dataSize', 'indexSize', 'size'])
    )
    expect(column(people, 'name')).toMatchObject({ collation: 'C', comment: 'who' })
    expect(column(people, 'id')).toMatchObject({ nullable: false, collation: null })
    const names = await propertiesOf(at(), { kind: 'relation', schema, relation: 'names' })
    expect(section(names, 'view').options).toMatch(/security_barrier/)
  })
})

const SQLSERVER_URL = process.env.ORCA_TEST_SQLSERVER_URL

describe.skipIf(!SQLSERVER_URL)('SQL Server properties', () => {
  const database = `orca_props_${randomUUID().slice(0, 8)}`
  const login = `orca_props_${randomUUID().slice(0, 8)}`
  const password = `Orca-${randomUUID().slice(0, 12)}-Pw1`
  const at = (): Target => serverConnectionFromUrl('sqlserver', SQLSERVER_URL!)
  const inDatabase = (): Target => {
    const { connection, password: adminPassword } = at()
    return {
      connection: connection.driver === 'sqlite' ? connection : { ...connection, database },
      password: adminPassword
    }
  }

  beforeAll(async () => {
    await runAdminSql(at(), [
      `create database ${database} collate Latin1_General_CS_AS`,
      `create login ${login} with password = '${password}', check_policy = off`
    ])
    await runAdminSql(
      at(),
      [
        `create table dbo.people (id int primary key, name nvarchar(20) collate Japanese_CI_AS not null)`,
        "insert into dbo.people values (1, N'a'), (2, N'b')",
        'create view dbo.names with schemabinding as select name from dbo.people',
        `exec sys.sp_addextendedproperty @name = N'MS_Description', @value = N'the people',
           @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'people'`,
        `exec sys.sp_addextendedproperty @name = N'MS_Description', @value = N'who',
           @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'people',
           @level2type = N'COLUMN', @level2name = N'name'`,
        `create user ${login} for login ${login}`,
        `alter role db_datareader add member ${login}`
      ],
      { database }
    )
  })

  afterAll(async () => {
    await runAdminSql(
      at(),
      [
        `alter database ${database} set single_user with rollback immediate`,
        `drop database ${database}`,
        `drop login ${login}`
      ],
      { ignoreErrors: true }
    )
  })

  it('reads the server’s and a database’s collation', async () => {
    const server = await propertiesOf(at(), { kind: 'server' })
    expect(Object.keys(section(server, 'server'))).toEqual(
      expect.arrayContaining(['version', 'edition', 'collation'])
    )
    const named = section(await propertiesOf(at(), { kind: 'database', database }), 'database')
    expect(named).toMatchObject({ collation: 'Latin1_General_CS_AS', readOnly: 'false' })
    expect(Object.keys(named)).toEqual(expect.arrayContaining(['recoveryModel', 'size']))
  })

  it('reads a table’s rows, sizes and description, and its columns’ collation', async () => {
    const people = await propertiesOf(inDatabase(), {
      kind: 'relation',
      schema: 'dbo',
      relation: 'people'
    })
    expect(section(people, 'table')).toMatchObject({ rowsEstimate: '2', comment: 'the people' })
    expect(Object.keys(section(people, 'table'))).toEqual(
      expect.arrayContaining(['created', 'modified', 'dataSize', 'size'])
    )
    expect(column(people, 'name')).toMatchObject({
      dataType: 'nvarchar(20)',
      collation: 'Japanese_CI_AS',
      comment: 'who'
    })
    const names = await propertiesOf(inDatabase(), {
      kind: 'relation',
      schema: 'dbo',
      relation: 'names'
    })
    expect(section(names, 'view')).toMatchObject({ type: 'view', schemaBound: 'true' })
  })

  it('leaves out what a reader may not see, and says so', async () => {
    const { connection } = inDatabase()
    const reader: Target = {
      connection: connection.driver === 'sqlite' ? connection : { ...connection, user: login },
      password
    }
    const people = await propertiesOf(reader, {
      kind: 'relation',
      schema: 'dbo',
      relation: 'people'
    })
    // Row counts come from sys.partitions; sizes need VIEW DATABASE STATE.
    expect(section(people, 'table').rowsEstimate).toBe('2')
    expect(section(people, 'table').size).toBeUndefined()
    expect(people.notes.join(' ')).toMatch(/Couldn't read the sizes/)
  })
})
