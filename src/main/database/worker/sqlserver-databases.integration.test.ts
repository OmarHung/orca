import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// Opt-in through ORCA_TEST_SQLSERVER_URL; the login must be allowed to create a database.

const fixture = DRIVER_FIXTURES.find((candidate) => candidate.driver === 'sqlserver')!
const target = fixture.open()

describe.skipIf(!target)('SQL Server databases', () => {
  const harness = createWorkerHarness()
  const setupConsole = randomUUID()
  const other = `orca_it_other_${randomUUID().slice(0, 8).replaceAll('-', '')}`
  const run = (consoleId: string, sql: string, database?: string) =>
    harness.send({ type: 'execute', consoleId, sql, pageSize: 100, database })

  beforeAll(async () => {
    await expectOk(harness.send({ type: 'connect', ...target! }))
    await expectOk(run(setupConsole, `create database ${other}`))
    await expectOk(run(setupConsole, `create table ${other}.dbo.items (id int primary key)`))
    await expectOk(run(setupConsole, `insert into ${other}.dbo.items values (1), (2)`))
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
    await expectOk(harness.send({ type: 'connect', ...target! }))
    await run(setupConsole, `drop database ${other}`)
    await harness.send({ type: 'close' })
  })

  it('lists the server’s databases, marking the connection’s own', async () => {
    const result = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'databases' } })
    )
    const databases = result.level === 'databases' ? result.databases : []
    expect(databases.map((database) => database.name)).toContain(other)
    expect(databases.filter((database) => database.isCurrent).map((d) => d.name)).toEqual([
      'master'
    ])
  })

  it('runs a console in the database it picked, and follows a USE', async () => {
    const console = randomUUID()
    expect((await run(console, 'select count(*) from items')).ok).toBe(false)
    const counted = await expectOk(run(console, 'select count(*) from items', other))
    expect(onlyRows(counted).rows).toEqual([['2']])
    const switched = await expectOk(run(console, 'use master', other))
    expect(switched.database).toBe('master')
  })

  it('reads another database’s catalog and DDL without moving the connection’s own', async () => {
    const relations = await expectOk(
      harness.send({
        type: 'introspect',
        target: { level: 'relations', database: other, schema: 'dbo' }
      })
    )
    expect(relations).toEqual({ level: 'relations', relations: [{ name: 'items', kind: 'table' }] })
    const ddl = await expectOk(
      harness.send({
        type: 'ddl',
        target: { kind: 'relation', database: other, schema: 'dbo', relation: 'items' }
      })
    )
    expect(ddl.ddl).toMatch(/^CREATE TABLE dbo\.items/)
    const own = await expectOk(harness.send({ type: 'introspect', target: { level: 'databases' } }))
    expect(own.level === 'databases' && own.databases.find((d) => d.isCurrent)?.name).toBe('master')
  })
})
