import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// Opt-in through ORCA_TEST_POSTGRES_URL; the role must be allowed to create a database.

const fixture = DRIVER_FIXTURES.find((candidate) => candidate.driver === 'postgres')!
const target = fixture.open()

describe.skipIf(!target)('PostgreSQL databases', () => {
  const harness = createWorkerHarness()
  const setupConsole = randomUUID()
  const other = `orca_it_other_${randomUUID().slice(0, 8)}`
  const run = (consoleId: string, sql: string, database?: string, mode?: 'manual') =>
    harness.send({
      type: 'execute',
      consoleId,
      sql,
      pageSize: 100,
      database,
      transactionMode: mode
    })

  beforeAll(async () => {
    await expectOk(harness.send({ type: 'connect', ...target! }))
    await expectOk(run(setupConsole, `create database ${other}`))
    await expectOk(run(setupConsole, 'create table items (id int primary key)', other))
    await expectOk(run(setupConsole, 'insert into items values (1), (2)', other))
    await expectOk(run(setupConsole, "create type mood as enum ('ok', 'meh')", other))
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
    await expectOk(harness.send({ type: 'connect', ...target! }))
    await harness.send({
      type: 'execute',
      consoleId: randomUUID(),
      sql: `drop database if exists ${other} with (force)`,
      pageSize: 1
    })
    await harness.send({ type: 'close' })
  })

  it('lists the server’s databases, marking the connection’s own', async () => {
    const result = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'databases' } })
    )
    const databases = result.level === 'databases' ? result.databases : []
    expect(databases.map((database) => database.name)).toContain(other)
    expect(databases.filter((database) => database.isCurrent)).toHaveLength(1)
  })

  it('reads another database’s catalog and DDL on a session of its own', async () => {
    const relations = await expectOk(
      harness.send({
        type: 'introspect',
        target: { level: 'relations', database: other, schema: 'public' }
      })
    )
    expect(relations).toEqual({ level: 'relations', relations: [{ name: 'items', kind: 'table' }] })
    const ddl = await expectOk(
      harness.send({
        type: 'ddl',
        target: { kind: 'relation', database: other, schema: 'public', relation: 'items' }
      })
    )
    expect(ddl.ddl).toMatch(/^CREATE TABLE public\.items/)
  })

  it('moves a console to the database it picks, but not away from an open transaction', async () => {
    const console = randomUUID()
    expect((await run(console, 'select count(*) from items')).ok).toBe(false)
    const counted = await expectOk(run(console, 'select count(*) from items', other))
    expect(onlyRows(counted).rows).toEqual([['2']])

    await expectOk(run(console, 'select 1', other, 'manual'))
    const refused = await run(console, 'select 1', undefined, 'manual')
    expect(refused).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/before switching database/) }
    })
    await expectOk(run(console, 'rollback', other, 'manual'))
    expect((await run(console, 'select count(*) from items')).ok).toBe(false)
  })

  it('names a column of a type that only the picked database has', async () => {
    const result = await expectOk(run(randomUUID(), "select 'ok'::mood as feeling", other))
    expect(onlyRows(result).columns).toEqual([{ name: 'feeling', typeName: 'mood' }])
  })
})
