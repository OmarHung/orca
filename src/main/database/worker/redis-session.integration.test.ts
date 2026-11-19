import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import { buildTableDataSql } from '../../../shared/database/table-data-sql'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// redis://[:password@]host:port; the suite writes only keys under its own prefix in db 9.
const TEST_URL = process.env.ORCA_TEST_REDIS_URL
const DATABASE = 9

function redisConnection(url: string): {
  connection: DatabaseConnectionDraft
  password: string | null
} {
  const parsed = new URL(url)
  return {
    connection: {
      driver: 'redis',
      name: 'redis integration',
      host: parsed.hostname,
      port: Number(parsed.port),
      database: String(DATABASE),
      user: decodeURIComponent(parsed.username),
      sslMode: 'disable',
      passwordStorage: 'never'
    },
    password: parsed.password ? decodeURIComponent(parsed.password) : null
  }
}

describe.skipIf(!TEST_URL)('redis driver (integration)', () => {
  const harness = createWorkerHarness()
  const consoleId = randomUUID()
  const prefix = `orca-it:${randomUUID().slice(0, 8)}:`
  const key = (name: string): string => `${prefix}${name}`
  let admin: Redis
  const execute = (sql: string, pageSize = 500) =>
    harness.send({ type: 'execute', consoleId, sql, pageSize, schema: `db${DATABASE}` })

  beforeAll(async () => {
    const { connection, password } = redisConnection(TEST_URL!)
    admin = new Redis({
      host: connection.driver === 'redis' ? connection.host : '',
      port: connection.driver === 'redis' ? connection.port : 0,
      password: password ?? undefined,
      db: DATABASE
    })
    await admin.set(key('greeting'), 'hello')
    await admin.set(key('bytes'), Buffer.from([0xff, 0x00, 0xfe]))
    await admin.hset(
      key('big-hash'),
      Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`f${index}`, `v${index}`]))
    )
    await admin.rpush(key('list'), 'a', 'b', 'c')
    await admin.zadd(key('ranking'), 2, 'second', 1, 'first')
    await admin.xadd(key('stream'), '1-1', 'event', 'signup')
    await expectOk(harness.send({ type: 'connect', connection, password }))
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
    const keys = await admin.keys(`${prefix}*`)
    if (keys.length > 0) {
      await admin.del(...keys)
    }
    admin.disconnect()
  })

  it('lists databases with the connection’s own current, and its keys with their types', async () => {
    const schemas = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'schemas' } })
    )
    expect(schemas).toMatchObject({ level: 'schemas' })
    const names = schemas.level === 'schemas' ? schemas.schemas : []
    expect(names.find((schema) => schema.isCurrent)?.name).toBe(`db${DATABASE}`)
    const relations = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'relations', schema: `db${DATABASE}` } })
    )
    const ours =
      relations.level === 'relations'
        ? relations.relations.filter((relation) => relation.name.startsWith(prefix))
        : []
    expect(
      ours.map((relation) => [relation.name.slice(prefix.length), relation.kind, relation.comment])
    ).toEqual([
      ['big-hash', 'key', 'hash'],
      ['bytes', 'key', 'string'],
      ['greeting', 'key', 'string'],
      ['list', 'key', 'list'],
      ['ranking', 'key', 'zset'],
      ['stream', 'key', 'stream']
    ])
  })

  it('shows replies as grids shaped by the command', async () => {
    expect(onlyRows(await expectOk(execute(`GET ${key('greeting')}`))).rows).toEqual([['hello']])
    expect(onlyRows(await expectOk(execute(`GET ${key('bytes')}`))).rows).toEqual([['0xff00fe']])
    const ranking = onlyRows(await expectOk(execute(`ZRANGE ${key('ranking')} 0 -1 WITHSCORES`)))
    expect(ranking.columns.map((column) => column.name)).toEqual(['member', 'score'])
    expect(ranking.rows).toEqual([
      ['first', '1'],
      ['second', '2']
    ])
    const scan = await expectOk(execute(`SCAN 0 MATCH "${prefix}l*" COUNT 1000`))
    expect(
      scan.results.map((result) => (result.kind === 'rows' ? result.columns[0]?.name : null))
    ).toEqual(['key', 'next cursor'])
  })

  it('pages a large hash through the key viewer', async () => {
    const sql = buildTableDataSql({
      driver: 'redis',
      schema: `db${DATABASE}`,
      relation: key('big-hash'),
      where: '',
      orderBy: ''
    })
    const first = onlyRows(await expectOk(execute(sql)))
    expect(first.columns.map((column) => column.name)).toEqual(['field', 'value'])
    expect(first.rows).toHaveLength(500)
    expect(first.hasMore).toBe(true)
    let rows = first.rows.length
    let hasMore = first.hasMore
    while (hasMore) {
      const page = await expectOk(
        harness.send({ type: 'fetch', consoleId, resultId: first.resultId, pageSize: 500 })
      )
      rows += page.rows.length
      hasMore = page.hasMore
    }
    expect(rows).toBe(1200)
  })

  it('shows lists in order and stream entries with their fields', async () => {
    const list = onlyRows(await expectOk(execute(`ORCA.VIEW ${key('list')}`)))
    expect(list.rows).toEqual([
      ['0', 'a'],
      ['1', 'b'],
      ['2', 'c']
    ])
    const stream = onlyRows(await expectOk(execute(`ORCA.VIEW ${key('stream')}`)))
    expect(stream.rows).toEqual([['1-1', '{"event":"signup"}']])
  })

  it('refuses commands that write and leaves the data as it was', async () => {
    for (const command of [
      `SET ${key('greeting')} changed`,
      'FLUSHALL',
      'CONFIG SET maxmemory 1',
      `DEL ${key('list')}`
    ]) {
      const result = await execute(command)
      expect(result.ok, command).toBe(false)
      expect(result.ok ? '' : result.error.message).toContain('read-only')
    }
    expect(await admin.get(key('greeting'))).toBe('hello')
    expect(await admin.llen(key('list'))).toBe(3)
  })

  it('cancels a blocked command and keeps the console usable', async () => {
    const running = execute(`XREAD BLOCK 0 STREAMS ${key('stream')} $`)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await expectOk(harness.send({ type: 'cancel', consoleId }))).toEqual({ cancelled: true })
    const result = await running
    expect(result.ok ? null : result.error.code).toBe('cancelled')
    expect(onlyRows(await expectOk(execute('PING'))).rows).toEqual([['PONG']])
  })

  it('follows SELECT to another database', async () => {
    const result = await expectOk(execute('SELECT 3'))
    expect(result.schema).toBe('db3')
  })
})

const AUTH_URL = process.env.ORCA_TEST_REDIS_AUTH_URL

describe.skipIf(!AUTH_URL)('redis driver login (integration)', () => {
  it('asks for a password the server wants, and connects with it', async () => {
    const harness = createWorkerHarness()
    const { connection, password } = redisConnection(AUTH_URL!)
    const refused = await harness.send({ type: 'connect', connection, password: null })
    expect(refused.ok ? null : refused.error.code).toBe('password-required')
    const wrong = await harness.send({ type: 'connect', connection, password: 'not-it' })
    expect(wrong.ok ? null : wrong.error.code).toBe('password-required')
    await expectOk(harness.send({ type: 'connect', connection, password }))
    await harness.send({ type: 'close' })
  })
})
