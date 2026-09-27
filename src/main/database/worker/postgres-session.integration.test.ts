import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createWorkerHarness,
  expectOk,
  onlyRows,
  serverConnectionFromUrl
} from './database-worker-test-harness'

// PostgreSQL specifics; shared behaviour lives in database-driver-conformance.integration.test.ts.
const TEST_URL = process.env.ORCA_TEST_POSTGRES_URL

describe.skipIf(!TEST_URL)('postgres driver specifics (integration)', () => {
  const harness = createWorkerHarness()
  const consoleId = randomUUID()
  const execute = (sql: string) => harness.send({ type: 'execute', consoleId, sql, pageSize: 10 })

  beforeAll(async () => {
    await expectOk(
      harness.send({ type: 'connect', ...serverConnectionFromUrl('postgres', TEST_URL!) })
    )
  })

  afterAll(async () => {
    await harness.send({ type: 'close' })
  })

  it('keeps numeric precision, maps booleans, and names column types', async () => {
    const result = onlyRows(
      await expectOk(
        execute(
          "select 1::int as i, 'Ada'::text as t, true as b, 12345678901234567890.1234567891::numeric(30,10) as n"
        )
      )
    )
    expect(result.columns.map((column) => column.typeName)).toEqual([
      'integer',
      'text',
      'boolean',
      'numeric(30,10)'
    ])
    expect(result.rows).toEqual([['1', 'Ada', 'true', '12345678901234567890.1234567891']])
  })

  it('truncates oversized cells to a preview with the true length', async () => {
    const result = onlyRows(await expectOk(execute("select repeat('x', 20000)")))
    expect(result.rows[0]?.[0]).toMatchObject({ length: 20000 })
  })

  it('returns the error position and SQLSTATE', async () => {
    const result = await execute('select * from missing_table')
    expect(result.ok ? null : result.error).toMatchObject({ sqlState: '42P01', position: 15 })
  })
})
