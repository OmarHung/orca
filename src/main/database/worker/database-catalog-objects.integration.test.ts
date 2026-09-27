import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseIntrospectTarget } from '../../../shared/database/database-introspection-types'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk } from './database-worker-test-harness'

// Server drivers are opt-in through ORCA_TEST_{POSTGRES,MYSQL,MARIADB,SQLSERVER}_URL.

for (const fixture of DRIVER_FIXTURES) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} catalog objects`, () => {
    const harness = createWorkerHarness()
    const consoleId = randomUUID()
    const introspect = (introspectTarget: DatabaseIntrospectTarget) =>
      expectOk(harness.send({ type: 'introspect', target: introspectTarget }))
    const orders = { schema: fixture.schema, relation: 'orders' }

    beforeAll(async () => {
      await expectOk(harness.send({ type: 'connect', ...target! }))
      for (const sql of fixture.setup) {
        await expectOk(harness.send({ type: 'execute', consoleId, sql, pageSize: 100 }))
      }
    })

    afterAll(async () => {
      for (const sql of fixture.teardown) {
        await harness.send({ type: 'execute', consoleId, sql, pageSize: 100 })
      }
      await harness.send({ type: 'close' })
      fixture.dispose?.()
    })

    it('lists the schema’s functions and procedures', async () => {
      const result = await introspect({ level: 'routines', schema: fixture.schema })
      const routines = result.level === 'routines' ? result.routines : []
      if (fixture.driver === 'sqlite') {
        expect(routines).toEqual([])
        return
      }
      expect(routines.map((routine) => [routine.name, routine.kind])).toEqual([
        ['add_one', 'function'],
        ['noop', 'procedure']
      ])
      expect(routines[0]?.arguments).toMatch(/\bi\b.*\bint/i)
      if (fixture.driver === 'postgres') {
        expect(routines[0]?.identity).toMatch(/add_one\(integer\)$/)
      }
    })

    it('lists primary, unique and foreign keys, with what a foreign key references', async () => {
      const result = await introspect({ level: 'keys', ...orders })
      const keys = result.level === 'keys' ? result.keys : []
      expect(keys.map((key) => [key.kind, key.columns])).toEqual([
        ['primary', ['id']],
        ['unique', ['code']],
        ['foreign', ['person_id']]
      ])
      expect(keys[2]?.references).toEqual({
        schema: fixture.schema,
        relation: 'people',
        columns: ['id']
      })
      if (fixture.driver !== 'sqlite') {
        expect(keys.slice(1).map((key) => key.name)).toEqual([
          'orders_code_key',
          'orders_person_fk'
        ])
      }
    })

    it('lists indexes with their columns, the primary key first', async () => {
      const result = await introspect({ level: 'indexes', ...orders })
      const indexes = result.level === 'indexes' ? result.indexes : []
      // SQLite's INTEGER PRIMARY KEY is the rowid itself, which needs no index.
      if (fixture.driver !== 'sqlite') {
        expect(indexes[0]).toMatchObject({ columns: ['id'], unique: true, primary: true })
      }
      expect(indexes).toContainEqual({
        name: 'orders_person_idx',
        columns: ['person_id'],
        unique: false,
        primary: false
      })
      expect(indexes).toContainEqual(
        expect.objectContaining({ columns: ['code'], unique: true, primary: false })
      )
    })
  })
}
