import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import {
  buildTableCountSql,
  buildTableDataSql,
  orderByForSort
} from '../../../shared/database/table-data-sql'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk, onlyResult, onlyRows } from './database-worker-test-harness'

// Server drivers are opt-in through ORCA_TEST_{POSTGRES,MYSQL,MARIADB,SQLSERVER}_URL;
// SQLite always runs against a temporary file.

for (const fixture of DRIVER_FIXTURES) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} driver conformance`, () => {
    const harness = createWorkerHarness()
    const consoleId = randomUUID()
    const execute = (sql: string, pageSize = 500, id = consoleId) =>
      harness.send({ type: 'execute', consoleId: id, sql, pageSize })

    beforeAll(async () => {
      await expectOk(harness.send({ type: 'connect', ...target! }))
      for (const sql of fixture.setup) {
        await expectOk(execute(sql))
      }
    })

    afterAll(async () => {
      for (const sql of fixture.teardown) {
        await execute(sql)
      }
      await harness.send({ type: 'close' })
      fixture.dispose?.()
    })

    it('reports how many rows a command changed', async () => {
      const result = onlyResult(
        await expectOk(
          execute(`insert into ${fixture.table} (id, name) values (1, 'Ada'), (2, 'Bob')`)
        )
      )
      expect(result).toMatchObject({ kind: 'command', rowCount: 2 })
    })

    it('reports no row count for statements that change no rows, even after ones that did', async () => {
      const probe = `${fixture.table}_ddl`
      await expectOk(execute(`update ${fixture.table} set name = name`))
      const created = onlyResult(await expectOk(execute(`create table ${probe} (id int)`)))
      const dropped = onlyResult(await expectOk(execute(`drop table ${probe}`)))
      expect(created).toMatchObject({ kind: 'command', command: 'CREATE', rowCount: null })
      expect(dropped).toMatchObject({ kind: 'command', command: 'DROP', rowCount: null })
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

    it('keeps each console in its own session', async () => {
      const other = randomUUID()
      await expectOk(execute(fixture.begin))
      await expectOk(execute(`insert into ${fixture.table} (id, name) values (3, 'Cy')`))
      const seen = onlyRows(await expectOk(execute(fixture.isolatedCount, 500, other)))
      expect(seen.rows).toEqual([['2']])
      await expectOk(execute('rollback'))
      await harness.send({ type: 'closeConsole', consoleId: other })
    })

    it('refuses writes on a read-only connection', async () => {
      const readOnly = createWorkerHarness()
      await expectOk(readOnly.send({ type: 'connect', ...fixture.open(true)! }))
      const result = await readOnly.send({
        type: 'execute',
        consoleId: randomUUID(),
        sql: `insert into ${fixture.table} (id, name) values (9, 'No')`,
        pageSize: 10
      })
      expect(result.ok).toBe(false)
      await readOnly.send({ type: 'close' })
    })
  })
}
