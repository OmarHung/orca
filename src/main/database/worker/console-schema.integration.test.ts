import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { runAdminSql } from './database-test-admin'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// Only PostgreSQL (search_path) and MySQL/MariaDB (USE) switch schema per session.

for (const fixture of DRIVER_FIXTURES.filter(
  (candidate) => candidate.driver === 'postgres' || candidate.driver === 'mysql'
)) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} console schema`, () => {
    const harness = createWorkerHarness()
    const run = (consoleId: string, sql: string, schema?: string) =>
      harness.send({ type: 'execute', consoleId, sql, pageSize: 100, schema })

    beforeAll(async () => {
      await runAdminSql(target!, fixture.setup)
      await expectOk(harness.send({ type: 'connect', ...target! }))
    })

    afterAll(async () => {
      await harness.send({ type: 'close' })
      await runAdminSql(target!, fixture.teardown, { ignoreErrors: true })
      fixture.dispose?.()
    })

    it('resolves unqualified names in the schema the console picked', async () => {
      const console = randomUUID()
      expect((await run(console, 'select count(*) from people')).ok).toBe(false)
      const counted = await expectOk(run(console, 'select count(*) from people', fixture.schema))
      expect(onlyRows(counted).rows).toEqual([['0']])
      expect(counted.schema).toBeUndefined()
    })

    it('reports a switch the user makes, and switches back when the pick changes again', async () => {
      const console = randomUUID()
      await expectOk(run(console, 'select 1', fixture.schema))
      const away = fixture.driver === 'postgres' ? 'set search_path to public' : 'use orca_it'
      const switched = await expectOk(run(console, away, fixture.schema))
      expect(switched.schema).toBe(fixture.currentSchema)
      // The picker follows the report, so the next request carries the new schema.
      const followed = await run(console, 'select count(*) from people', fixture.currentSchema)
      expect(followed.ok).toBe(false)
      const pickedAgain = await run(console, 'select count(*) from people', fixture.schema)
      expect(pickedAgain.ok).toBe(true)
    })
  })
}
