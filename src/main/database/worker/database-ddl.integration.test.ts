import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type { DatabaseIntrospectTarget } from '../../../shared/database/database-introspection-types'
import { splitSqlStatements } from '../../../shared/database/sql-statement-splitter'
import { DRIVER_FIXTURES } from './database-driver-test-fixtures'
import { createWorkerHarness, expectOk } from './database-worker-test-harness'

// Server drivers are opt-in through ORCA_TEST_{POSTGRES,MYSQL,MARIADB,SQLSERVER}_URL.

for (const fixture of DRIVER_FIXTURES) {
  const target = fixture.open()
  describe.skipIf(!target)(`${fixture.label} DDL`, () => {
    const harness = createWorkerHarness()
    const setupConsole = randomUUID()
    const copyConsole = randomUUID()
    const copy = `${fixture.schema}_copy`
    const run = (sql: string, consoleId = setupConsole) =>
      expectOk(harness.send({ type: 'execute', consoleId, sql, pageSize: 100 }))
    const ddl = async (ddlTarget: DatabaseDdlTarget) =>
      (await expectOk(harness.send({ type: 'ddl', target: ddlTarget }))).ddl
    const introspect = (introspectTarget: DatabaseIntrospectTarget) =>
      expectOk(harness.send({ type: 'introspect', target: introspectTarget }))
    // Everything introspection reports about a table, with its schema swapped for the copy's.
    const shape = async (schema: string, relation: string) => {
      const [columns, keys, indexes] = await Promise.all([
        introspect({ level: 'columns', schema, relation }),
        introspect({ level: 'keys', schema, relation }),
        introspect({ level: 'indexes', schema, relation })
      ])
      return JSON.stringify({ columns, keys, indexes }).replaceAll(`"${schema}"`, '"SCHEMA"')
    }

    beforeAll(async () => {
      await expectOk(harness.send({ type: 'connect', ...target! }))
      for (const sql of fixture.setup) {
        await run(sql)
      }
    })

    afterAll(async () => {
      if (fixture.driver === 'postgres') {
        await harness.send({
          type: 'execute',
          consoleId: setupConsole,
          sql: `drop schema if exists ${copy} cascade`,
          pageSize: 1
        })
      }
      if (fixture.driver === 'mysql') {
        await harness.send({
          type: 'execute',
          consoleId: setupConsole,
          sql: `drop database if exists ${copy}`,
          pageSize: 1
        })
      }
      for (const sql of fixture.teardown) {
        await harness.send({ type: 'execute', consoleId: setupConsole, sql, pageSize: 1 })
      }
      await harness.send({ type: 'close' })
      fixture.dispose?.()
    })

    it('describes a table with its columns, keys, checks and indexes', async () => {
      const text = await ddl({ kind: 'relation', schema: fixture.schema, relation: 'orders' })
      expect(text).toMatch(/^CREATE TABLE/i)
      for (const fragment of [
        'person_id',
        'amount',
        'orders_person_idx',
        /references\s+\S*people/i
      ]) {
        expect(text).toMatch(fragment)
      }
      expect(text).toMatch(/check/i)
    })

    it('describes a view by its stored definition', async () => {
      const text = await ddl({ kind: 'relation', schema: fixture.schema, relation: 'people_view' })
      expect(text).toMatch(/create\b.*\bview\b/i)
      expect(text).toMatch(/people/)
    })

    // SQLite hands back the statements as written, so there is nothing to rebuild.
    it.skipIf(fixture.driver === 'sqlite')(
      'recreates the same tables and routines from its DDL in another schema',
      async () => {
        const dialect = fixture.driver
        const retarget = (text: string): string => text.replaceAll(`${fixture.schema}.`, `${copy}.`)
        if (fixture.driver === 'mysql') {
          await run(`create database ${copy}`)
          // SHOW CREATE names objects unqualified, so the copy runs with its database current.
          await run(`use ${copy}`, copyConsole)
        } else {
          await run(`create schema ${copy}`)
        }
        for (const relation of ['people', 'orders']) {
          const text = retarget(await ddl({ kind: 'relation', schema: fixture.schema, relation }))
          for (const statement of splitSqlStatements(text, dialect)) {
            await run(statement.text, copyConsole)
          }
        }
        expect(await shape(copy, 'orders')).toBe(await shape(fixture.schema, 'orders'))

        const routines = await introspect({ level: 'routines', schema: fixture.schema })
        for (const routine of routines.level === 'routines' ? routines.routines : []) {
          const text = await ddl({
            kind: 'routine',
            schema: fixture.schema,
            identity: routine.identity,
            routineKind: routine.kind
          })
          // Routine bodies hold semicolons, so each goes to the server whole.
          await run(retarget(text).replace(/;\s*$/, ''), copyConsole)
        }
        const copied = await introspect({ level: 'routines', schema: copy })
        const names = (result: typeof copied) =>
          result.level === 'routines'
            ? result.routines.map((routine) => [routine.name, routine.kind, routine.arguments])
            : []
        expect(names(copied)).toEqual(names(routines))

        if (fixture.driver === 'sqlserver') {
          for (const sql of [
            `drop procedure ${copy}.noop`,
            `drop function ${copy}.add_one`,
            `drop table ${copy}.orders`,
            `drop table ${copy}.people`,
            `drop schema ${copy}`
          ]) {
            await run(sql)
          }
        }
      }
    )
  })
}
