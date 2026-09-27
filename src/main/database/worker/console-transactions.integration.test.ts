import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseTransactionMode } from '../../../shared/database/database-query-types'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'

// Server drivers are opt-in through ORCA_TEST_{POSTGRES,MYSQL,MARIADB,SQLSERVER}_URL.

for (const fixture of DRIVER_FIXTURES) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} console transactions`, () => {
    const harness = createWorkerHarness()
    const setupConsole = randomUUID()
    const run = (consoleId: string, sql: string, mode: DatabaseTransactionMode = 'auto') =>
      harness.send({ type: 'execute', consoleId, sql, pageSize: 100, transactionMode: mode })
    const committedRows = async (): Promise<string> => {
      const sql = `select count(*) from ${fixture.table} where id = 900`
      return String(onlyRows(await expectOk(run(setupConsole, sql))).rows[0]?.[0])
    }

    beforeAll(async () => {
      await expectOk(harness.send({ type: 'connect', ...target! }))
      for (const sql of fixture.setup) {
        await expectOk(run(setupConsole, sql))
      }
    })

    afterAll(async () => {
      for (const sql of fixture.teardown) {
        await run(setupConsole, sql)
      }
      await harness.send({ type: 'close' })
      fixture.dispose?.()
    })

    it('holds manual-mode changes until Roll Back or Commit, and only then allows auto-commit', async () => {
      const console = randomUUID()
      const insert = `insert into ${fixture.table} (id, name) values (900, 'Tx')`
      expect((await expectOk(run(console, insert, 'manual'))).transaction).toBe('open')
      const refused = await run(console, 'select 1', 'auto')
      expect(refused).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(/Commit or roll back/), transaction: 'open' }
      })
      expect((await expectOk(run(console, 'rollback', 'manual'))).transaction).toBe('none')
      expect(await committedRows()).toBe('0')

      await expectOk(run(console, insert, 'manual'))
      expect((await expectOk(run(console, 'commit', 'manual'))).transaction).toBe('none')
      expect(await committedRows()).toBe('1')
      await expectOk(run(console, `delete from ${fixture.table} where id = 900`, 'manual'))
      await expectOk(run(console, 'commit', 'manual'))
      expect((await expectOk(run(console, 'select 1', 'auto'))).transaction).toBeUndefined()
      expect(await committedRows()).toBe('0')
    })

    it('reports a transaction opened by hand in auto-commit mode until it ends', async () => {
      const console = randomUUID()
      expect((await expectOk(run(console, fixture.begin))).transaction).toBe('open')
      expect((await expectOk(run(console, `select name from ${fixture.table}`))).transaction).toBe(
        'open'
      )
      expect((await expectOk(run(console, 'rollback'))).transaction).toBe('none')
      expect((await expectOk(run(console, 'select 1'))).transaction).toBeUndefined()
    })

    it.runIf(fixture.driver === 'postgres')(
      'reports a failed transaction that only a rollback can end',
      async () => {
        const console = randomUUID()
        await expectOk(run(console, `select 1 from ${fixture.table}`, 'manual'))
        expect(await run(console, 'select 1/0', 'manual')).toMatchObject({
          ok: false,
          error: { sqlState: '22012', transaction: 'failed' }
        })
        expect((await expectOk(run(console, 'rollback', 'manual'))).transaction).toBe('none')
      }
    )

    it.runIf(fixture.driver === 'mysql')(
      'reports the implicit commit that DDL causes in manual mode',
      async () => {
        const console = randomUUID()
        await expectOk(
          run(console, `insert into ${fixture.table} (id, name) values (901, 'Ddl')`, 'manual')
        )
        const ddl = `create table ${fixture.table}_ddl (id int)`
        expect((await expectOk(run(console, ddl, 'manual'))).transaction).toBe('none')
        await expectOk(run(console, `drop table ${fixture.table}_ddl`, 'manual'))
        await expectOk(run(console, `delete from ${fixture.table} where id = 901`, 'manual'))
        await expectOk(run(console, 'commit', 'manual'))
      }
    )

    it.runIf(fixture.driver === 'postgres')(
      'says so when the server ends a session that held an open transaction',
      async () => {
        const console = randomUUID()
        await expectOk(run(console, "set idle_in_transaction_session_timeout = '200ms'"))
        await expectOk(
          run(console, `insert into ${fixture.table} (id, name) values (902, 'Lost')`, 'manual')
        )
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        expect(await run(console, 'select 1', 'manual')).toMatchObject({
          ok: false,
          error: { message: expect.stringMatching(/rolled back/), transaction: 'none' }
        })
        // The console reconnects on its next statement, still in manual mode.
        expect((await expectOk(run(console, 'select 1', 'manual'))).transaction).toBe('open')
        await expectOk(run(console, 'rollback', 'manual'))
        const sql = `select count(*) from ${fixture.table} where id = 902`
        expect(onlyRows(await expectOk(run(setupConsole, sql))).rows).toEqual([['0']])
      }
    )
  })
}
