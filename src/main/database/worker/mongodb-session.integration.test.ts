import { randomUUID } from 'node:crypto'
import { Long, MongoClient, ObjectId } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import { buildTableCountSql, buildTableDataSql } from '../../../shared/database/table-data-sql'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// mongodb://user:password@host:port; the suite creates and drops a database of its own.
const TEST_URL = process.env.ORCA_TEST_MONGODB_URL

function mongoConnection(url: string): {
  connection: DatabaseConnectionDraft
  password: string | null
} {
  const parsed = new URL(url)
  return {
    connection: {
      driver: 'mongodb',
      name: 'mongodb integration',
      host: parsed.hostname,
      port: Number(parsed.port),
      database: '',
      authDatabase: '',
      user: decodeURIComponent(parsed.username),
      sslMode: 'disable',
      passwordStorage: 'never'
    },
    password: parsed.password ? decodeURIComponent(parsed.password) : null
  }
}

describe.skipIf(!TEST_URL)('mongodb driver (integration)', () => {
  const harness = createWorkerHarness()
  const consoleId = randomUUID()
  const database = `orca_it_${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const id = new ObjectId('64b7f0c2a1b2c3d4e5f60718')
  let admin: MongoClient
  const execute = (sql: string, pageSize = 500) =>
    harness.send({ type: 'execute', consoleId, sql, pageSize, schema: database })

  beforeAll(async () => {
    admin = new MongoClient(TEST_URL!, { directConnection: true })
    const db = admin.db(database)
    await db.collection('people').insertMany([
      {
        _id: id,
        name: 'Ada',
        born: new Date('1815-12-10T00:00:00Z'),
        visits: Long.fromString('9007199254740993'),
        address: { city: 'London' }
      },
      { name: 'Grace', tags: ['navy'] }
    ])
    await db
      .collection('people')
      .createIndexes([{ key: { name: 1 }, unique: true, name: 'name_unique' }])
    await db
      .collection('series')
      .insertMany(Array.from({ length: 1200 }, (_, index) => ({ n: index, group: index % 3 })))
    await db.createCollection('people_view', {
      viewOn: 'people',
      pipeline: [{ $project: { name: 1 } }]
    })
    await expectOk(harness.send({ type: 'connect', ...mongoConnection(TEST_URL!) }))
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
    await admin.db(database).dropDatabase()
    await admin.close()
  })

  it('lists databases, collections and views, sampled fields and indexes', async () => {
    const schemas = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'schemas' } })
    )
    expect(
      schemas.level === 'schemas' && schemas.schemas.some((schema) => schema.name === database)
    ).toBe(true)
    const relations = await expectOk(
      harness.send({ type: 'introspect', target: { level: 'relations', schema: database } })
    )
    expect(
      relations.level === 'relations'
        ? relations.relations.map((relation) => [relation.name, relation.kind])
        : []
    ).toEqual([
      ['people', 'collection'],
      ['people_view', 'view'],
      ['series', 'collection']
    ])
    const columns = await expectOk(
      harness.send({
        type: 'introspect',
        target: { level: 'columns', schema: database, relation: 'people' }
      })
    )
    expect(
      columns.level === 'columns'
        ? columns.columns.map((column) => [column.name, column.dataType, column.isPrimaryKey])
        : []
    ).toEqual([
      ['_id', 'objectId', true],
      ['name', 'string', false],
      ['born', 'date', false],
      ['visits', 'long', false],
      ['address', 'object', false],
      ['tags', 'array', false]
    ])
    const indexes = await expectOk(
      harness.send({
        type: 'introspect',
        target: { level: 'indexes', schema: database, relation: 'people' }
      })
    )
    expect(
      indexes.level === 'indexes' ? indexes.indexes.map((index) => [index.name, index.unique]) : []
    ).toEqual([
      ['_id_', false],
      ['name_unique', true]
    ])
  })

  it('reads documents with shell syntax, keeping 64-bit integers exact', async () => {
    const result = onlyRows(
      await expectOk(
        execute(`db.people.find({ _id: ObjectId("${id.toHexString()}") }, { tags: 0 })`)
      )
    )
    expect(result.columns.map((column) => column.name)).toEqual([
      '_id',
      'name',
      'born',
      'visits',
      'address'
    ])
    expect(result.rows).toEqual([
      [id.toHexString(), 'Ada', '1815-12-10T00:00:00.000Z', '9007199254740993', '{"city":"London"}']
    ])
  })

  it('pages a large result and runs aggregations, counts and distinct', async () => {
    const first = onlyRows(await expectOk(execute('db.series.find({}).sort({ n: 1 })')))
    expect(first.rows).toHaveLength(500)
    expect(first.hasMore).toBe(true)
    const second = await expectOk(
      harness.send({ type: 'fetch', consoleId, resultId: first.resultId, pageSize: 1000 })
    )
    expect(second.rows).toHaveLength(700)
    expect(second.hasMore).toBe(false)
    const grouped = onlyRows(
      await expectOk(
        execute(
          'db.series.aggregate([{ $group: { _id: "$group", count: { $sum: 1 } } }, { $sort: { _id: 1 } }])'
        )
      )
    )
    expect(grouped.rows).toEqual([
      ['0', '400'],
      ['1', '400'],
      ['2', '400']
    ])
    expect(
      onlyRows(await expectOk(execute('db.series.countDocuments({ n: { $lt: 10 } })'))).rows
    ).toEqual([['10']])
    expect(onlyRows(await expectOk(execute('db.series.distinct("group")'))).rows).toEqual([
      ['0'],
      ['1'],
      ['2']
    ])
  })

  it('runs the table view’s filter, sort and count', async () => {
    const table = { driver: 'mongodb' as const, schema: database, relation: 'series' }
    const sql = buildTableDataSql({ ...table, where: 'n: { $gte: 1198 }', orderBy: 'n: -1' })
    expect(onlyRows(await expectOk(execute(sql))).rows.map((row) => row[1])).toEqual([
      '1199',
      '1198'
    ])
    const count = buildTableCountSql({ ...table, where: '{ group: 0 }' }) ?? ''
    expect(onlyRows(await expectOk(execute(count))).rows).toEqual([['400']])
  })

  it('refuses statements that write and leaves the data as it was', async () => {
    for (const statement of [
      'db.people.insertOne({ name: "Mallory" })',
      'db.people.aggregate([{ $match: {} }, { $out: "stolen" }])',
      'db.people.aggregate([{ $facet: { x: [{ $merge: { into: "stolen" } }] } }])',
      'db.runCommand({ drop: "people" })',
      'db.people.drop()'
    ]) {
      const result = await execute(statement)
      expect(result.ok, statement).toBe(false)
      expect(result.ok ? '' : result.error.message).toContain('read-only')
    }
    expect(await admin.db(database).collection('people').countDocuments()).toBe(2)
    expect(await admin.db(database).listCollections({ name: 'stolen' }).toArray()).toEqual([])
  })

  it('points at the error in a statement it can’t read', async () => {
    const result = await execute('db.people.find({ name: })')
    // 1-based, at the `}` where a value should be.
    expect(result.ok ? null : result.error.position).toBe(24)
  })

  it('follows use to another database', async () => {
    expect((await expectOk(execute('use admin'))).schema).toBe('admin')
  })

  it('shows a collection’s DDL with its indexes and its properties', async () => {
    const ddl = await expectOk(
      harness.send({
        type: 'ddl',
        target: { kind: 'relation', schema: database, relation: 'people' }
      })
    )
    expect(ddl.ddl).toContain('db.createCollection("people")')
    expect(ddl.ddl).toContain('createIndex(')
    expect(ddl.ddl).toContain('"name_unique"')
    const properties = await expectOk(
      harness.send({
        type: 'properties',
        target: { kind: 'relation', schema: database, relation: 'people' }
      })
    )
    expect(properties.sections[0]?.properties).toContainEqual({
      key: 'documentCount',
      value: '2',
      format: 'count'
    })
  })

  it('asks for a password when the server refuses the one given', async () => {
    const other = createWorkerHarness()
    const { connection } = mongoConnection(TEST_URL!)
    const refused = await other.send({ type: 'connect', connection, password: 'not-it' })
    expect(refused.ok ? null : refused.error.code).toBe('password-required')
  })
})
