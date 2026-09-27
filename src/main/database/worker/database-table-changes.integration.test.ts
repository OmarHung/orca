import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TableChangeSet } from '../../../shared/database/table-change-sql'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// Same opt-in servers as the conformance suite; SQLite always runs.

const TRICKY_NAME = "O'Brien'); DROP TABLE people; --"

for (const fixture of DRIVER_FIXTURES) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} table changes`, () => {
    const harness = createWorkerHarness()
    const consoleId = randomUUID()
    const relation = `edits_${randomUUID().replaceAll('-', '').slice(0, 8)}`
    const table = fixture.schema === 'main' ? relation : `${fixture.schema}.${relation}`
    const execute = (sql: string) => harness.send({ type: 'execute', consoleId, sql, pageSize: 50 })
    const apply = (changes: TableChangeSet['changes']) =>
      harness.send({
        type: 'applyChanges',
        consoleId,
        changeSet: { schema: fixture.schema, relation, keyColumns: ['id'], changes }
      })
    const contents = async (): Promise<unknown[][]> =>
      onlyRows(await expectOk(execute(`select id, name, note from ${table} order by id`))).rows

    beforeAll(async () => {
      await expectOk(harness.send({ type: 'connect', ...target! }))
      for (const sql of fixture.setup) {
        await expectOk(execute(sql))
      }
      await expectOk(
        execute(`create table ${table} (id int primary key, name varchar(60), note varchar(20))`)
      )
    })

    beforeEach(async () => {
      await expectOk(execute(`delete from ${table}`))
      await expectOk(
        execute(`insert into ${table} values (1, 'Ada', null), (2, 'Bob', 'x'), (3, 'Cy', null)`)
      )
    })

    afterAll(async () => {
      await execute(`drop table ${table}`)
      for (const sql of fixture.teardown) {
        await execute(sql)
      }
      await harness.send({ type: 'close' })
      fixture.dispose?.()
    })

    it('applies deletes, updates and inserts together, binding every value', async () => {
      const result = await expectOk(
        apply([
          { kind: 'delete', key: ['3'] },
          {
            kind: 'update',
            key: ['1'],
            set: [
              { column: 'name', value: TRICKY_NAME },
              { column: 'note', value: 'n1' }
            ]
          },
          // An unchanged value still matches its one row (MySQL needs FOUND_ROWS for this).
          {
            kind: 'update',
            key: ['2'],
            set: [
              { column: 'name', value: 'Bob' },
              { column: 'note', value: null }
            ]
          },
          {
            kind: 'insert',
            values: [
              { column: 'id', value: '4' },
              { column: 'name', value: 'Di' }
            ]
          }
        ])
      )
      expect(result).toEqual({ applied: 4 })
      expect(await contents()).toEqual([
        ['1', TRICKY_NAME, 'n1'],
        ['2', 'Bob', null],
        ['4', 'Di', null]
      ])
    })

    it('rolls everything back when a row changed or vanished since it was loaded', async () => {
      const result = await apply([
        { kind: 'update', key: ['1'], set: [{ column: 'name', value: 'Changed' }] },
        { kind: 'delete', key: ['99'] }
      ])
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatchObject({
        changeIndex: 1,
        message: expect.stringContaining('changed 0')
      })
      expect((await contents())[0]).toEqual(['1', 'Ada', null])
    })

    it('rolls everything back on a server error and says which change failed', async () => {
      const result = await apply([
        { kind: 'update', key: ['1'], set: [{ column: 'note', value: 'first' }] },
        { kind: 'insert', values: [{ column: 'id', value: '2' }] }
      ])
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error.changeIndex).toBe(1)
      expect((await contents())[0]).toEqual(['1', 'Ada', null])
      // The session is still usable after the rollback.
      expect(await contents()).toHaveLength(3)
    })
  })
}
