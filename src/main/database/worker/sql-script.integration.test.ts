import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDriver } from '../../../shared/database/database-connection-types'
import type { DatabaseScriptOptions } from '../../../shared/database/database-script-types'
import { DRIVER_FIXTURES, type DriverFixture } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk, onlyRows } from './database-worker-test-harness'
import type { SqlScriptFileSource } from './sql-script-runner'

// Scripts in each dialect's own syntax, run through the worker the way the Database page does.

const dir = mkdtempSync(join(tmpdir(), 'orca-script-it-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function scriptFile(text: string): SqlScriptFileSource {
  const name = `${randomUUID()}.sql`
  writeFileSync(join(dir, name), text)
  return { path: join(dir, name), name, size: Buffer.byteLength(text) }
}

/** One statement per batch: SQL Server scripts separate them with GO, others with `;`. */
function script(driver: DatabaseDriver, statements: string[]): string {
  return driver === 'sqlserver'
    ? statements.map((statement) => `${statement}\nGO\n`).join('')
    : statements.map((statement) => `${statement};\n`).join('')
}

function dialectScript(driver: DatabaseDriver, table: string, schema: string): string {
  const setup = [
    `create table ${table} (id int primary key, label ${driver === 'sqlserver' ? 'nvarchar(20)' : 'text'})`,
    `insert into ${table} values (1, 'a;b'), (2, 'it''s')`
  ]
  switch (driver) {
    case 'postgres':
      return `${script(driver, setup)}create function ${schema}.script_fn() returns int as $$ begin return 1; end $$ language plpgsql;\nselect ${schema}.script_fn();\n`
    case 'mysql':
      return `${script(driver, setup)}DELIMITER //\ncreate procedure ${schema}.script_proc() begin select 1; select 2; end //\nDELIMITER ;\ncall ${schema}.script_proc();\n`
    case 'sqlserver':
      return `${script(driver, setup)}create procedure ${schema}.script_proc as begin select 1; select 2; end\nGO\nexec ${schema}.script_proc\nGO\n`
    case 'sqlite':
      return `${script(driver, setup)}create trigger script_tr after insert on script_items begin update script_items set label = label where id = new.id; end;\nselect count(*) from script_items;\n`
  }
}

function describeDriver(fixture: DriverFixture): void {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} SQL scripts`, () => {
    const harness = createWorkerHarness()
    const consoleId = randomUUID()
    const schema = fixture.schema
    const table = fixture.driver === 'sqlite' ? 'script_items' : `${schema}.script_items`
    const runScript = (text: string, options: Partial<DatabaseScriptOptions> = {}) =>
      harness.send({
        type: 'runScript',
        jobId: randomUUID(),
        files: [scriptFile(text)],
        options: { onError: 'stop', transaction: false, ...options }
      })
    const count = async (): Promise<string> => {
      const result = await expectOk(
        harness.send({
          type: 'execute',
          consoleId,
          sql: `select count(*) from ${table}`,
          // Why more than one: SQLite keeps a page-sized read open, locking out the script's writes.
          pageSize: 10
        })
      )
      return String(onlyRows(result).rows[0]?.[0])
    }

    beforeAll(async () => {
      await expectOk(harness.send({ type: 'connect', ...target! }))
      for (const sql of fixture.setup) {
        await expectOk(harness.send({ type: 'execute', consoleId, sql, pageSize: 1 }))
      }
    })

    afterAll(async () => {
      const extra =
        fixture.driver === 'sqlserver'
          ? [`drop procedure ${schema}.script_proc`, `drop table ${table}`]
          : []
      for (const sql of [...extra, ...fixture.teardown]) {
        await harness.send({ type: 'execute', consoleId, sql, pageSize: 1 })
      }
      await harness.send({ type: 'close' })
      fixture.dispose?.()
    })

    it('runs a script in the dialect’s own syntax, statement by statement', async () => {
      const summary = await expectOk(runScript(dialectScript(fixture.driver, table, schema)))
      expect(summary).toMatchObject({ failed: 0, cancelled: false, failures: [] })
      expect(summary.statements).toBe(4)
      expect(await count()).toBe('2')
      expect(harness.progress.at(-1)).toMatchObject({ kind: 'script', statements: 4 })
    })

    it('keeps going past a failure when asked, reporting its line', async () => {
      const text = script(fixture.driver, [
        `insert into ${table} values (3, 'x')`,
        `insert into ${table}_missing values (1, 'x')`,
        `insert into ${table} values (4, 'y')`
      ])
      const summary = await expectOk(runScript(text, { onError: 'continue' }))
      expect(summary).toMatchObject({ statements: 2, failed: 1 })
      expect(summary.failures[0]?.line).toBe(fixture.driver === 'sqlserver' ? 3 : 2)
      expect(await count()).toBe('4')
    })

    it('rolls the whole run back when a statement fails inside its transaction', async () => {
      const text = script(fixture.driver, [
        `insert into ${table} values (5, 'x')`,
        `insert into ${table}_missing values (1, 'x')`,
        `insert into ${table} values (6, 'y')`
      ])
      const summary = await expectOk(runScript(text, { transaction: true }))
      expect(summary).toMatchObject({ statements: 1, failed: 1, transaction: 'rolled-back' })
      expect(await count()).toBe('4')

      const committed = await expectOk(
        runScript(script(fixture.driver, [`insert into ${table} values (7, 'z')`]), {
          transaction: true
        })
      )
      expect(committed.transaction).toBe('committed')
      expect(await count()).toBe('5')
    })

    it.skipIf(fixture.sleep === null)(
      'stops at a cancel, cutting the running statement short',
      async () => {
        const jobId = randomUUID()
        const running = harness.send({
          type: 'runScript',
          jobId,
          files: [scriptFile(script(fixture.driver, [fixture.sleep!, 'select 1']))],
          options: { onError: 'stop', transaction: false }
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(await expectOk(harness.send({ type: 'cancelJob', jobId }))).toEqual({
          cancelled: true
        })
        const summary = await expectOk(running)
        expect(summary).toMatchObject({ cancelled: true, failed: 0 })
        // An interrupted MySQL/MariaDB SLEEP may return 1 instead of failing; `select 1` still never runs.
        expect(summary.statements).toBeLessThanOrEqual(fixture.driver === 'mysql' ? 1 : 0)
        expect(summary.durationMs).toBeLessThan(10_000)
      }
    )
  })
}

for (const fixture of DRIVER_FIXTURES) {
  describeDriver(fixture)
}
