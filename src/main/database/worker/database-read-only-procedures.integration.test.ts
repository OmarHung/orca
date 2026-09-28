import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import { runAdminSql } from './database-test-admin'
import { openDriverSession } from './database-worker-dispatch'
import {
  createWorkerHarness,
  expectOk,
  onlyRows,
  serverConnectionFromUrl
} from './database-worker-test-harness'

// Opt-in through ORCA_TEST_{SQLSERVER,POSTGRES,MYSQL,MARIADB}_URL. Every server here can run a
// procedure that commits on its own, so Orca must refuse to call one rather than trust the
// session: each test first shows the escape working without the check, then the check stopping it.

type Target = { connection: DatabaseConnectionDraft; password: string | null }

/** The same server connection, in another database. */
function inDatabase(
  connection: DatabaseConnectionDraft,
  database: string
): DatabaseConnectionDraft {
  return connection.driver === 'sqlite' ? connection : { ...connection, database }
}

/**
 * A server's admin target and its target in `database`, read from the URL on first use: a
 * skipped suite is still collected, and must not read a URL that isn't there.
 */
function serverAt(
  url: string | undefined,
  driver: 'postgres' | 'mysql' | 'sqlserver',
  database: string
): () => { server: Target; target: Target } {
  let parsed: { server: Target; target: Target } | null = null
  return () => {
    if (!url) {
      throw new Error(`No ${driver} test server URL is set.`)
    }
    const server = parsed?.server ?? serverConnectionFromUrl(driver, url)
    parsed ??= {
      server,
      target: { ...server, connection: inDatabase(server.connection, database) }
    }
    return parsed
  }
}

/** A console on a worker of its own, as the page runs statements. */
function consoleOn(target: () => Target) {
  const harness = createWorkerHarness()
  const consoleId = randomUUID()
  return {
    open: () => expectOk(harness.send({ type: 'connect', ...target() })),
    run: (sql: string) => harness.send({ type: 'execute', consoleId, sql, pageSize: 100 }),
    close: () => harness.send({ type: 'close' })
  }
}

/** One value read on a fresh session, so it sees only what was committed. */
async function committed(target: Target, sql: string): Promise<string> {
  const reader = consoleOn(() => target)
  await reader.open()
  try {
    return String(onlyRows(await expectOk(reader.run(sql))).rows[0]?.[0])
  } finally {
    await reader.close()
  }
}

/** Runs `sql` straight on a driver session, as a statement the check missed would arrive. */
async function pastTheCheck(target: Target, sql: string): Promise<void> {
  const session = await openDriverSession(target.connection, target.password, {
    onConnectionLost: () => undefined
  })
  try {
    await session.execute(randomUUID(), sql, 10, {}).catch(() => undefined)
  } finally {
    await session.close()
  }
}

const refusedAs = (word: string) => ({
  ok: false,
  error: { message: expect.stringContaining(`read-only, so ${word} statements are not run`) }
})

const sqlServerDatabase = `orca_ro_${randomUUID().slice(0, 8)}`
const SQLSERVER_URL = process.env.ORCA_TEST_SQLSERVER_URL

describe.skipIf(!SQLSERVER_URL)('SQL Server read-only boundary', () => {
  const at = serverAt(SQLSERVER_URL, 'sqlserver', sqlServerDatabase)
  const console = consoleOn(() => at().target)
  const logged = () => committed(at().target, 'select count(*) from dbo.audit_log')
  const lastOrderId = () =>
    committed(
      at().target,
      "select cast(current_value as int) from sys.sequences where name = 'order_ids'"
    )

  beforeAll(async () => {
    await runAdminSql(at().server, [`create database ${sqlServerDatabase}`])
    await runAdminSql(
      at().server,
      [
        'create table dbo.audit_log (id int identity primary key, note nvarchar(50))',
        'create sequence dbo.order_ids start with 100',
        'declare @first bigint = next value for dbo.order_ids',
        `create procedure dbo.archive_orders as begin
           insert into dbo.audit_log (note) values ('archived')
           while @@trancount > 0 commit
         end`,
        // A user procedure with a system procedure's name, which EXEC sp_help must never reach.
        `create procedure dbo.sp_help as begin
           insert into dbo.audit_log (note) values ('shadowed')
           while @@trancount > 0 commit
         end`
      ],
      { database: sqlServerDatabase }
    )
    await console.open()
  })

  afterAll(async () => {
    await console.close()
    await runAdminSql(
      at().server,
      [
        `alter database ${sqlServerDatabase} set single_user with rollback immediate`,
        `drop database ${sqlServerDatabase}`
      ],
      { ignoreErrors: true }
    )
  })

  it('refuses procedures, whose own COMMIT outlives the batch’s rollback', async () => {
    await pastTheCheck(at().target, 'exec dbo.archive_orders')
    expect(await logged()).toBe('1')
    await runAdminSql(at().server, ['delete from dbo.audit_log'], { database: sqlServerDatabase })

    const calls = [
      'exec dbo.archive_orders',
      'dbo.archive_orders',
      'execute [dbo].[archive_orders]',
      "declare @proc sysname = N'dbo.archive_orders'; exec @proc",
      'select 1 exec dbo.archive_orders',
      'exec dbo.sp_help'
    ]
    for (const sql of calls) {
      expect(await console.run(sql), sql).toMatchObject(refusedAs('EXEC'))
    }
    expect(await logged()).toBe('0')
  })

  it('runs the read-only system procedures, never a user procedure of the same name', async () => {
    const help = await expectOk(console.run("exec sp_help 'dbo.audit_log'"))
    expect(help.results.length).toBeGreaterThan(1)
    const text = await expectOk(console.run("sp_helptext 'dbo.archive_orders'"))
    expect(JSON.stringify(text)).toContain('archived')
    await expectOk(console.run("exec sys.sp_columns @table_name = N'audit_log'"))
    // dbo.sp_help would have logged a row.
    expect(await logged()).toBe('0')
  })

  it('refuses a sequence’s next value, which a rollback doesn’t hand back', async () => {
    const before = await lastOrderId()
    await pastTheCheck(at().target, 'select next value for dbo.order_ids')
    const after = await lastOrderId()
    expect(Number(after)).toBe(Number(before) + 1)

    expect(await console.run('select next value for dbo.order_ids as id')).toMatchObject(
      refusedAs('NEXT VALUE FOR')
    )
    expect(await lastOrderId()).toBe(after)
  })

  it('asks for the password again when SQL Server refuses the login', async () => {
    const attempt = consoleOn(() => ({
      connection: at().server.connection,
      password: 'not-the-password'
    }))
    expect(await attempt.open().catch((error: unknown) => String(error))).toMatch(
      /Login failed for user/
    )
    const harness = createWorkerHarness()
    expect(
      await harness.send({ type: 'connect', connection: at().server.connection, password: 'nope' })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'password-required',
        sqlState: '18456',
        message: expect.stringMatching(/^Login failed for user/)
      }
    })
    // SQL Server reports a database it can't open as the same failed login; the reason stays.
    expect(
      await harness.send({
        type: 'connect',
        connection: inDatabase(at().server.connection, 'orca_no_such_database'),
        password: at().server.password
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'password-required',
        message: expect.stringMatching(/Cannot open database "orca_no_such_database".*Login failed/)
      }
    })
  })
})

const postgresSchema = `orca_ro_${randomUUID().slice(0, 8)}`
const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

describe.skipIf(!POSTGRES_URL)('PostgreSQL read-only boundary', () => {
  const at = serverAt(POSTGRES_URL, 'postgres', '')
  const console = consoleOn(() => at().server)

  beforeAll(async () => {
    await runAdminSql(at().server, [
      `create schema ${postgresSchema}`,
      `create table ${postgresSchema}.audit_log (note text)`,
      `create procedure ${postgresSchema}.archive_orders() language plpgsql as $$
       begin
         set default_transaction_read_only = off;
         commit;
         insert into ${postgresSchema}.audit_log values ('archived');
       end $$`
    ])
    await console.open()
  })

  afterAll(async () => {
    await console.close()
    await runAdminSql(at().server, [`drop schema if exists ${postgresSchema} cascade`], {
      ignoreErrors: true
    })
  })

  it('refuses CALL, whose procedure can leave the read-only session and commit', async () => {
    const logged = () => committed(at().server, `select count(*) from ${postgresSchema}.audit_log`)
    await pastTheCheck(at().server, `call ${postgresSchema}.archive_orders()`)
    expect(await logged()).toBe('1')
    await runAdminSql(at().server, [`delete from ${postgresSchema}.audit_log`])

    expect(await console.run(`call ${postgresSchema}.archive_orders()`)).toMatchObject(
      refusedAs('CALL')
    )
    expect(await logged()).toBe('0')
  })
})

describe.each([
  { label: 'MySQL', url: process.env.ORCA_TEST_MYSQL_URL },
  { label: 'MariaDB', url: process.env.ORCA_TEST_MARIADB_URL }
])('$label read-only boundary', ({ url }) => {
  const database = `orca_ro_${randomUUID().slice(0, 8)}`
  const at = serverAt(url, 'mysql', database)
  const console = consoleOn(() => at().target)

  beforeAll(async () => {
    if (!url) {
      return
    }
    await runAdminSql(at().server, [
      `create database ${database}`,
      `create table ${database}.audit_log (note varchar(20))`,
      `create procedure ${database}.archive_orders() begin
         set session transaction read write;
         commit;
         insert into ${database}.audit_log values ('archived');
         commit;
       end`
    ])
    await console.open()
  })

  afterAll(async () => {
    if (url) {
      await console.close()
      await runAdminSql(at().server, [`drop database if exists ${database}`], {
        ignoreErrors: true
      })
    }
  })

  it.skipIf(!url)('refuses CALL and PREPARE, which reach a procedure that commits', async () => {
    const { target } = at()
    const logged = () => committed(target, 'select count(*) from audit_log')
    await pastTheCheck(target, 'call archive_orders()')
    expect(await logged()).toBe('1')
    await runAdminSql(at().server, [`delete from ${database}.audit_log`])

    expect(await console.run('call archive_orders()')).toMatchObject(refusedAs('CALL'))
    expect(await console.run("prepare s from 'call archive_orders()'")).toMatchObject(
      refusedAs('PREPARE')
    )
    expect(await console.run('execute s')).toMatchObject(refusedAs('EXECUTE'))
    expect(await logged()).toBe('0')
  })
})
