import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createWorkerHarness,
  expectOk,
  onlyRows,
  serverConnectionFromUrl
} from './database-worker-test-harness'
import { runAdminSql } from './database-test-admin'

// Driver specifics the shared conformance suite can't express in portable SQL.
const MYSQL_URL = process.env.ORCA_TEST_MYSQL_URL
const SQLSERVER_URL = process.env.ORCA_TEST_SQLSERVER_URL

describe.skipIf(!MYSQL_URL)('mysql driver specifics (integration)', () => {
  const harness = createWorkerHarness()
  const execute = (sql: string) =>
    harness.send({ type: 'execute', consoleId: 'mysql-specifics', sql, pageSize: 10 })

  beforeAll(async () => {
    await expectOk(
      harness.send({ type: 'connect', ...serverConnectionFromUrl('mysql', MYSQL_URL!) })
    )
  })
  afterAll(async () => {
    await harness.send({ type: 'close' })
  })

  it('keeps exact text for big numbers, decimals, dates and JSON, and hex for binary', async () => {
    const result = onlyRows(
      await expectOk(
        execute(
          "select cast(18446744073709551615 as unsigned) as big, cast('12345678901234567890.1234567891' as decimal(30,10)) as dec_value, timestamp('2026-09-27 12:34:56.789') as ts, json_object('a', 1) as js, x'00ff' as bin"
        )
      )
    )
    expect(result.rows).toEqual([
      [
        '18446744073709551615',
        '12345678901234567890.1234567891',
        '2026-09-27 12:34:56.789',
        '{"a": 1}',
        '0x00ff'
      ]
    ])
    expect(result.columns.map((column) => column.typeName)).toEqual([
      'bigint unsigned',
      'decimal',
      'datetime',
      'json',
      'varbinary'
    ])
  })

  it('shows BIT columns as numbers', async () => {
    const admin = serverConnectionFromUrl('mysql', MYSQL_URL!)
    const table = `orca_bits_${randomUUID().slice(0, 8)}`
    await runAdminSql(admin, [
      `create table ${table} (b bit(3))`,
      `insert into ${table} values (b'101')`
    ])
    try {
      const result = onlyRows(await expectOk(execute(`select b from ${table}`)))
      expect(result.rows).toEqual([['5']])
      expect(result.columns[0]?.typeName).toBe('bit')
    } finally {
      await runAdminSql(admin, [`drop table ${table}`])
    }
  })

  it('reports the line of a syntax error', async () => {
    const result = await execute('select 1,\n  from nowhere where')
    expect(result.ok ? null : result.error.line).toBe(2)
  })
})

describe.skipIf(!SQLSERVER_URL)('sql server driver specifics (integration)', () => {
  const harness = createWorkerHarness()
  const consoleId = randomUUID()
  const execute = (sql: string, pageSize = 10) =>
    harness.send({ type: 'execute', consoleId, sql, pageSize })

  beforeAll(async () => {
    await expectOk(
      harness.send({ type: 'connect', ...serverConnectionFromUrl('sqlserver', SQLSERVER_URL!) })
    )
  })
  afterAll(async () => {
    await harness.send({ type: 'close' })
  })

  it('returns every result set of a batch, with variables in scope', async () => {
    const { results } = await expectOk(
      execute('declare @x int = 41;\nselect @x + 1 as answer;\nselect 2 as b, 3 as c')
    )
    expect(results.map((result) => (result.kind === 'rows' ? result.rows : result.kind))).toEqual([
      [['42']],
      [['2', '3']]
    ])
  })

  it('delivers the result sets after a paged one with its last page', async () => {
    const series =
      'select top (15) row_number() over (order by (select null)) as n from sys.all_objects'
    const first = await expectOk(execute(`${series};\nselect 'after' as tail`, 10))
    expect(first.results).toHaveLength(1)
    const paged = first.results[0]
    expect(paged).toMatchObject({ kind: 'rows', hasMore: true })
    const page = await expectOk(
      harness.send({
        type: 'fetch',
        consoleId,
        resultId: paged?.kind === 'rows' ? paged.resultId : '',
        pageSize: 10
      })
    )
    expect(page.rows).toHaveLength(5)
    expect(page.hasMore).toBe(false)
    expect(page.followingResults?.map((result) => result.kind === 'rows' && result.rows)).toEqual([
      [['after']]
    ])
  })

  it('formats SQL Server values like SSMS and names their types', async () => {
    const result = onlyRows(
      await expectOk(
        execute(
          "select cast(1 as bit) as flag, cast('2026-09-27T12:34:56.789' as datetime2(3)) as ts, cast('2026-09-27' as date) as d, cast(0x00ff as varbinary(4)) as bin, cast(N'中文' as nvarchar(10)) as text_value, cast(123.45 as decimal(10,2)) as amount"
        )
      )
    )
    expect(result.rows).toEqual([
      ['true', '2026-09-27 12:34:56.789', '2026-09-27', '0x00FF', '中文', '123.45']
    ])
    expect(result.columns.map((column) => column.typeName)).toEqual([
      'bit',
      'datetime2(3)',
      'date',
      'varbinary(4)',
      'nvarchar(10)',
      'decimal(10,2)'
    ])
  })

  it('reports the line of an error inside a batch', async () => {
    const result = await execute('select 1;\nselect * from orca_missing_table')
    expect(result.ok ? null : result.error).toMatchObject({ line: 2, sqlState: '208' })
  })
})
