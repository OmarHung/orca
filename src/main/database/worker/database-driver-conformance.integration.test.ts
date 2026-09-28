import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import {
  buildTableCountSql,
  buildTableDataSql,
  orderByForSort
} from '../../../shared/database/table-data-sql'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { runAdminSql } from './database-test-admin'
import { openDriverSession } from './database-worker-dispatch'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// Server drivers are opt-in through ORCA_TEST_{POSTGRES,MYSQL,MARIADB,SQLSERVER}_URL;
// SQLite always runs against a temporary file.

for (const fixture of DRIVER_FIXTURES) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} driver conformance`, () => {
    const harness = createWorkerHarness()
    const consoleId = randomUUID()
    const execute = (sql: string, pageSize = 500, id = consoleId) =>
      harness.send({ type: 'execute', consoleId: id, sql, pageSize })

    const peopleCount = async (): Promise<string> =>
      String(
        onlyRows(await expectOk(execute(`select count(*) from ${fixture.table}`))).rows[0]?.[0]
      )

    beforeAll(async () => {
      await runAdminSql(target!, [
        ...fixture.setup,
        `insert into ${fixture.table} (id, name) values (1, 'Ada'), (2, 'Bob')`
      ])
      await expectOk(harness.send({ type: 'connect', ...target! }))
    })

    afterAll(async () => {
      await harness.send({ type: 'close' })
      await runAdminSql(target!, fixture.teardown, { ignoreErrors: true })
      fixture.dispose?.()
    })

    it('refuses writes before they reach the server', async () => {
      const result = await execute(`insert into ${fixture.table} (id, name) values (9, 'No')`)
      expect(result).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(/read-only, so INSERT statements are not run/) }
      })
      expect(await peopleCount()).toBe('2')
    })

    it('never keeps a write that gets past that check', async () => {
      // Straight to the driver session, as a write the keyword check can't see would arrive.
      const session = await openDriverSession(target!.connection, target!.password, {
        onConnectionLost: () => undefined
      })
      await session
        .execute(randomUUID(), `insert into ${fixture.table} (id, name) values (9, 'No')`, 10, {})
        .catch(() => undefined)
      await session.close()
      expect(await peopleCount()).toBe('2')
    })

    it('pages a large result through the open statement', async () => {
      const first = onlyRows(await expectOk(execute(fixture.series(1200))))
      expect(first.rows).toHaveLength(500)
      expect(first.hasMore).toBe(true)
      const fetch = () =>
        expectOk(
          harness.send({ type: 'fetch', consoleId, resultId: first.resultId, pageSize: 500 })
        )
      const second = await fetch()
      expect(second).toMatchObject({ hasMore: true })
      expect(second.rows[0]).toEqual(['501'])
      const third = await fetch()
      expect(third.rows).toHaveLength(200)
      expect(third.hasMore).toBe(false)
      expect(third.rows.at(-1)).toEqual(['1200'])
    })

    it('ships long text and binary as previews, and reads them back whole across pages', async () => {
      const first = onlyRows(await expectOk(execute(fixture.longValues(3), 2)))
      expect(first.rows[0]).toEqual([
        '1',
        { preview: 'x'.repeat(10_000), length: 12_001 },
        { preview: fixture.longBinary.slice(0, 10_000), length: 12_002 }
      ])
      const second = await expectOk(
        harness.send({ type: 'fetch', consoleId, resultId: first.resultId, pageSize: 2 })
      )
      expect(second.rows[0]?.[0]).toBe('3')
      const whole = (row: number, column: number) => ({ row, column, start: 0, end: 20_000 })
      const read = await expectOk(
        harness.send({
          type: 'readValues',
          consoleId,
          resultId: first.resultId,
          slices: [
            whole(0, 1),
            whole(2, 1),
            whole(2, 2),
            { row: 1, column: 1, start: 11_999, end: 12_001 }
          ]
        })
      )
      expect(read.values).toEqual([
        `${'x'.repeat(12_000)}1`,
        `${'x'.repeat(12_000)}3`,
        fixture.longBinary,
        'x2'
      ])
    })

    it('fails cleanly on a missing table and keeps the console usable', async () => {
      const result = await execute('select * from orca_missing_table')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toMatch(/orca_missing_table/i)
      }
      expect(onlyRows(await expectOk(execute(fixture.series(1)))).rows).toEqual([['1']])
    })

    it('introspects schemas, relations and columns', async () => {
      const schemas = await expectOk(
        harness.send({ type: 'introspect', target: { level: 'schemas' } })
      )
      expect(schemas.level === 'schemas' && schemas.schemas.map((s) => s.name)).toContain(
        fixture.schema
      )
      expect(
        schemas.level === 'schemas' && schemas.schemas.filter((s) => s.isCurrent).map((s) => s.name)
      ).toEqual([fixture.currentSchema])
      const relations = await expectOk(
        harness.send({ type: 'introspect', target: { level: 'relations', schema: fixture.schema } })
      )
      expect(relations).toEqual({
        level: 'relations',
        relations: [
          { name: 'orders', kind: 'table' },
          { name: 'people', kind: 'table' },
          { name: 'people_view', kind: 'view' },
          { name: 'user', kind: 'table' }
        ]
      })
      const columns = await expectOk(
        harness.send({
          type: 'introspect',
          target: { level: 'columns', schema: fixture.schema, relation: 'people' }
        })
      )
      expect(
        columns.level === 'columns' && columns.columns.map((c) => [c.name, c.isPrimaryKey])
      ).toEqual([
        ['id', true],
        ['name', false]
      ])
    })

    it('runs table data queries on reserved and mixed-case names', async () => {
      const table = { driver: fixture.driver, schema: fixture.schema, relation: 'user' }
      const orderBy = orderByForSort('order', 'desc', fixture.driver)
      const sorted = onlyRows(
        await expectOk(execute(buildTableDataSql({ ...table, where: '', orderBy })))
      )
      expect(sorted.columns.map((column) => column.name)).toEqual(['order', 'Mixed Case'])
      expect(sorted.rows.map((row) => row[0])).toEqual(['3', '2', '1'])
      const where = `${quoteSqlName('Mixed Case', fixture.driver)} is not null`
      const counted = onlyRows(await expectOk(execute(buildTableCountSql({ ...table, where }))))
      expect(counted.rows).toEqual([['2']])
    })

    it.skipIf(!fixture.sleep)('cancels a running statement', async () => {
      const startedAt = Date.now()
      const running = execute(fixture.sleep!)
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(await expectOk(harness.send({ type: 'cancel', consoleId }))).toEqual({
        cancelled: true
      })
      const result = await running
      // A 30 s sleep that ends in seconds was cancelled. MySQL's SLEEP() returns 1 when
      // interrupted instead of failing, so only a failure has to carry the cancelled code.
      expect(Date.now() - startedAt).toBeLessThan(10_000)
      if (!result.ok) {
        expect(result.error.code).toBe('cancelled')
      }
    })
  })
}
