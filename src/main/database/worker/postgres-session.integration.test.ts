import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../../shared/database/database-query-types'
import { createDatabaseWorkerDispatcher } from './database-worker-dispatch'
import type {
  DatabaseWorkerCommand,
  DatabaseWorkerCommandType,
  DatabaseWorkerMessage,
  DatabaseWorkerValues
} from './database-worker-protocol'

// Opt-in: point at a disposable server, e.g. postgres://orca_test@127.0.0.1:55439/postgres
const TEST_URL = process.env.ORCA_TEST_POSTGRES_URL

function draftFromUrl(url: string, readOnly = false): DatabaseConnectionDraft {
  const parsed = new URL(url)
  return {
    driver: 'postgres',
    name: 'integration',
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: parsed.pathname.slice(1),
    user: decodeURIComponent(parsed.username),
    sslMode: 'disable',
    readOnly,
    passwordStorage: 'never'
  }
}

type Harness = {
  send: <T extends DatabaseWorkerCommandType>(
    command: Extract<DatabaseWorkerCommand, { type: T }>
  ) => Promise<DatabaseResult<DatabaseWorkerValues[T]>>
  lost: string[]
}

function createHarness(): Harness {
  const lost: string[] = []
  const pending = new Map<number, (result: DatabaseResult<unknown>) => void>()
  let nextId = 1
  const dispatch = createDatabaseWorkerDispatcher((message: DatabaseWorkerMessage) => {
    if (message.kind === 'connection-lost') {
      lost.push(message.message)
      return
    }
    pending.get(message.id)?.(message.result)
  })
  return {
    lost,
    send: (command) => {
      const id = nextId++
      return new Promise((resolve) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher answers each command type with its DatabaseWorkerValues entry.
        pending.set(id, (result) => resolve(result as DatabaseResult<never>))
        void dispatch({ id, command })
      })
    }
  }
}

async function expectOk<T>(promise: Promise<DatabaseResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`)
  }
  return result.value
}

describe.skipIf(!TEST_URL)('postgres driver (integration)', () => {
  const schema = `orca_it_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const harness = createHarness()
  const consoleId = randomUUID()

  beforeAll(async () => {
    await expectOk(
      harness.send({ type: 'connect', connection: draftFromUrl(TEST_URL!), password: null })
    )
    for (const sql of [
      `create schema ${schema}`,
      `create table ${schema}.people (id int primary key, name text not null, active boolean, score numeric(30, 10))`,
      `create view ${schema}.active_people as select * from ${schema}.people where active`
    ]) {
      await expectOk(harness.send({ type: 'execute', consoleId, sql, pageSize: 10 }))
    }
  })

  afterAll(async () => {
    await harness.send({
      type: 'execute',
      consoleId,
      sql: `drop schema ${schema} cascade`,
      pageSize: 10
    })
    await harness.send({ type: 'close' })
  })

  it('reports command results with row counts', async () => {
    const result = await expectOk(
      harness.send({
        type: 'execute',
        consoleId,
        sql: `insert into ${schema}.people values (1, 'Ada', true, 12345678901234567890.1234567891), (2, 'Bob', false, null)`,
        pageSize: 10
      })
    )
    expect(result).toMatchObject({ kind: 'command', command: 'INSERT', rowCount: 2 })
  })

  it('keeps numeric precision, maps booleans, and names column types', async () => {
    const result = await expectOk(
      harness.send({
        type: 'execute',
        consoleId,
        sql: `select id, name, active, score from ${schema}.people order by id`,
        pageSize: 10
      })
    )
    expect(result.kind).toBe('rows')
    if (result.kind !== 'rows') {
      return
    }
    expect(result.columns.map((column) => column.typeName)).toEqual([
      'integer',
      'text',
      'boolean',
      'numeric(30,10)'
    ])
    expect(result.rows).toEqual([
      ['1', 'Ada', 'true', '12345678901234567890.1234567891'],
      ['2', 'Bob', 'false', null]
    ])
    expect(result.hasMore).toBe(false)
  })

  it('pages large results through the cursor', async () => {
    const first = await expectOk(
      harness.send({
        type: 'execute',
        consoleId,
        sql: 'select generate_series(1, 1200)',
        pageSize: 500
      })
    )
    expect(first).toMatchObject({ kind: 'rows', hasMore: true })
    if (first.kind !== 'rows') {
      return
    }
    expect(first.rows).toHaveLength(500)
    const second = await expectOk(
      harness.send({ type: 'fetch', consoleId, resultId: first.resultId, pageSize: 500 })
    )
    expect(second.rows[0]).toEqual(['501'])
    const third = await expectOk(
      harness.send({ type: 'fetch', consoleId, resultId: first.resultId, pageSize: 500 })
    )
    expect(third).toMatchObject({ hasMore: false })
    expect(third.rows).toHaveLength(200)
  })

  it('truncates oversized cells to a preview with the true length', async () => {
    const result = await expectOk(
      harness.send({ type: 'execute', consoleId, sql: "select repeat('x', 20000)", pageSize: 10 })
    )
    expect(result.kind === 'rows' ? result.rows[0]?.[0] : undefined).toMatchObject({
      length: 20000
    })
  })

  it('returns the error position and SQLSTATE', async () => {
    const result = await harness.send({
      type: 'execute',
      consoleId,
      sql: 'select * from missing_table',
      pageSize: 10
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({ sqlState: '42P01', position: 15 })
    }
  })

  it('introspects schemas, relations and columns', async () => {
    const schemas = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'schemas' } })
    )
    expect(schemas.level === 'schemas' && schemas.schemas.map((s) => s.name)).toContain(schema)
    const relations = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'relations', schema } })
    )
    expect(relations).toEqual({
      level: 'relations',
      relations: [
        { name: 'active_people', kind: 'view' },
        { name: 'people', kind: 'table' }
      ]
    })
    const columns = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'columns', schema, relation: 'people' } })
    )
    expect(columns.level === 'columns' && columns.columns[0]).toEqual({
      name: 'id',
      dataType: 'integer',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: true
    })
  })

  it('cancels a running statement from another session', async () => {
    const running = harness.send({
      type: 'execute',
      consoleId,
      sql: 'select pg_sleep(30)',
      pageSize: 10
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const cancel = await expectOk(harness.send({ type: 'cancel', consoleId }))
    expect(cancel.cancelled).toBe(true)
    const result = await running
    expect(result.ok ? null : result.error.code).toBe('cancelled')
  })

  it('keeps each console in its own server session', async () => {
    const other = randomUUID()
    await expectOk(harness.send({ type: 'execute', consoleId, sql: 'begin', pageSize: 10 }))
    await expectOk(
      harness.send({
        type: 'execute',
        consoleId,
        sql: `insert into ${schema}.people values (3, 'Cy', true, 1)`,
        pageSize: 10
      })
    )
    const seen = await expectOk(
      harness.send({
        type: 'execute',
        consoleId: other,
        sql: `select count(*) from ${schema}.people`,
        pageSize: 10
      })
    )
    expect(seen.kind === 'rows' && seen.rows[0]).toEqual(['2'])
    await expectOk(harness.send({ type: 'execute', consoleId, sql: 'rollback', pageSize: 10 }))
    await expectOk(harness.send({ type: 'closeConsole', consoleId: other }))
  })

  it('enforces read-only connections', async () => {
    const readOnly = createHarness()
    await expectOk(
      readOnly.send({ type: 'connect', connection: draftFromUrl(TEST_URL!, true), password: null })
    )
    const result = await readOnly.send({
      type: 'execute',
      consoleId: randomUUID(),
      sql: `insert into ${schema}.people values (9, 'No', true, 1)`,
      pageSize: 10
    })
    expect(result.ok ? null : result.error.sqlState).toBe('25006')
    await readOnly.send({ type: 'close' })
  })
})
