import { describe, expect, it } from 'vitest'
import type {
  DatabaseDumpOptions,
  DatabaseDumpRequest,
  DatabaseDumpTool
} from '../../../../../shared/database/database-dump-types'
import { mysqldumpRuns } from './mysqldump-plan'
import { mysqlOptionFileText } from './mysql-option-file'
import type { NativeDumpTarget, NativeServerConnection } from './native-dump-plan'
import { pgDumpPlan } from './pg-dump-plan'

const PG_DUMP: DatabaseDumpTool = {
  kind: 'pg_dump',
  flavor: 'postgres',
  path: '/opt/homebrew/bin/pg_dump',
  version: '17.9',
  problem: null
}
const MYSQLDUMP: DatabaseDumpTool = {
  kind: 'mysqldump',
  flavor: 'mysql',
  path: '/usr/local/bin/mysqldump',
  version: '8.4.3',
  problem: null
}
const MARIADB_DUMP: DatabaseDumpTool = { ...MYSQLDUMP, kind: 'mariadb-dump', flavor: 'mariadb' }

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 100,
  dropExisting: false,
  engine: 'native'
}

function target(connection: Partial<NativeServerConnection> & { driver: 'postgres' | 'mysql' }) {
  const base = {
    name: 'test',
    host: 'db.example.com',
    port: 5432,
    database: 'shop',
    user: 'orca',
    sslMode: 'prefer' as const,
    passwordStorage: 'forever' as const,
    ...connection
  }
  const resolved: NativeServerConnection =
    base.driver === 'postgres' ? { ...base, driver: 'postgres' } : { ...base, driver: 'mysql' }
  const result: NativeDumpTarget = { connection: resolved, password: 'secret', serverVersion: '17' }
  return result
}

const request = (changes: Partial<DatabaseDumpRequest> = {}): DatabaseDumpRequest => ({
  objects: [
    { kind: 'table', schema: 'sales', name: 'people' },
    { kind: 'table', schema: 'sales', name: 'orders' },
    { kind: 'view', schema: 'sales', name: 'people view' },
    {
      kind: 'routine',
      schema: 'sales',
      name: 'add_one',
      identity: 'sales.add_one(integer)',
      routineKind: 'function'
    },
    { kind: 'table', schema: 'Odd"Schema', name: 'log' }
  ],
  options: OPTIONS,
  completeSchemas: ['sales'],
  ...changes
})

describe('pgDumpPlan', () => {
  it('dumps whole schemas with -n and single tables with exact-match patterns', () => {
    const plan = pgDumpPlan({
      tool: PG_DUMP,
      target: target({ driver: 'postgres' }),
      request: request()
    })
    expect(plan.runs).toHaveLength(1)
    expect(plan.runs[0]!.args).toEqual([
      '--host=db.example.com',
      '--port=5432',
      '--username=orca',
      "--dbname=dbname='shop'",
      '--no-password',
      '--format=plain',
      '--encoding=UTF8',
      '--no-owner',
      '--no-privileges',
      '--rows-per-insert=100',
      '--schema="sales"',
      '--table="Odd""Schema"."log"'
    ])
    expect(plan.env).toMatchObject({
      PGPASSWORD: 'secret',
      PGSSLMODE: 'prefer',
      PGOPTIONS: '-c default_transaction_read_only=on'
    })
    expect(plan.env.PGHOSTADDR).toBeUndefined()
    expect(plan.notes.join(' ')).toMatch(/types and functions that single tables use/)
  })

  it('dials the tunnel but checks TLS against the real host', () => {
    const plan = pgDumpPlan({
      tool: PG_DUMP,
      target: target({
        driver: 'postgres',
        host: '127.0.0.1',
        port: 61000,
        tlsServerName: 'db.example.com'
      }),
      request: request()
    })
    expect(plan.runs[0]!.args.slice(0, 2)).toEqual(['--host=db.example.com', '--port=61000'])
    expect(plan.env.PGHOSTADDR).toBe('127.0.0.1')
  })

  it('splits a file per table into pre-data, one data run per table, and the rest', () => {
    const plan = pgDumpPlan({
      tool: PG_DUMP,
      target: target({ driver: 'postgres' }),
      request: request({ options: { ...OPTIONS, layout: 'file-per-table', dropExisting: true } })
    })
    expect(plan.runs.map((run) => run.label)).toEqual([
      'setup',
      'sales.people',
      'sales.orders',
      'Odd"Schema.log',
      'finish'
    ])
    const [setup, people, , , finish] = plan.runs
    expect(setup!.args).toEqual(
      expect.arrayContaining(['--section=pre-data', '--clean', '--if-exists'])
    )
    expect(setup!.prelude).toMatch(/ALTER TABLE %s DROP CONSTRAINT %I/)
    expect(setup!.prelude).toContain(`to_regclass('"sales"."people"')`)
    expect(people!.args.slice(-3)).toEqual([
      '--section=data',
      '--rows-per-insert=100',
      '--table="sales"."people"'
    ])
    expect(finish!.args).toEqual(
      expect.arrayContaining([
        '--section=data',
        '--section=post-data',
        '--exclude-table-data="sales"."people"'
      ])
    )
  })

  it('turns triggers off for a data export, and refuses routines it can’t pick', () => {
    const data = pgDumpPlan({
      tool: { ...PG_DUMP, version: '11.22' },
      target: target({ driver: 'postgres' }),
      request: request({ options: { ...OPTIONS, contents: 'data' } })
    })
    expect(data.runs[0]!.args).toEqual(
      expect.arrayContaining(['--data-only', '--inserts', '--disable-triggers'])
    )
    expect(data.notes.join(' ')).toMatch(/one row per INSERT/)
    expect(() =>
      pgDumpPlan({
        tool: PG_DUMP,
        target: target({ driver: 'postgres' }),
        request: request({ objects: request().objects.slice(3, 4), completeSchemas: [] })
      })
    ).toThrow(/single routines/)
  })
})

describe('mysqldumpRuns', () => {
  const mysql = target({ driver: 'mysql', port: 3306, database: '' })

  it('names the tables of a partly selected database, and whole databases by name', () => {
    const { runs, notes } = mysqldumpRuns(
      {
        tool: MYSQLDUMP,
        target: mysql,
        request: request({ completeSchemas: [] })
      },
      '/tmp/client.cnf'
    )
    expect(runs.map((run) => run.label)).toEqual(['sales', 'Odd"Schema'])
    expect(runs[0]!.args.slice(-4)).toEqual(['sales', 'people', 'orders', 'people view'])
    expect(runs[1]!.args.slice(-2)).toEqual(['Odd"Schema', 'log'])
    expect(runs[1]!.args).not.toContain('--routines')
    expect(runs[0]!.args[0]).toBe('--defaults-extra-file=/tmp/client.cnf')
    expect(runs[0]!.args).toEqual(
      expect.arrayContaining([
        '--protocol=TCP',
        '--single-transaction',
        '--ssl-mode=PREFERRED',
        '--get-server-public-key',
        '--set-gtid-purged=OFF',
        '--skip-column-statistics',
        '--skip-add-drop-table',
        '--routines'
      ])
    )
    // Two databases in one file: each is created and entered.
    expect(runs[1]!.prelude).toBe(
      'CREATE DATABASE IF NOT EXISTS `Odd"Schema`;\nUSE `Odd"Schema`;\n\n'
    )
    expect(notes.join(' ')).toMatch(/every routine of sales/)
  })

  it('gives each table its own run, and views and routines one each', () => {
    const { runs } = mysqldumpRuns(
      {
        tool: MYSQLDUMP,
        target: mysql,
        request: request({
          objects: request().objects.slice(0, 4),
          options: { ...OPTIONS, layout: 'file-per-table', rowsPerInsert: 1 }
        })
      },
      null
    )
    expect(runs.map((run) => run.label)).toEqual([
      'sales.people',
      'sales.orders',
      'sales.views',
      'sales.routines'
    ])
    expect(runs[0]!.args).toContain('--skip-extended-insert')
    expect(runs[0]!.args.some((arg) => arg.startsWith('--defaults-extra-file'))).toBe(false)
    expect(runs.map((run) => run.prelude)).toEqual(['', '', '', ''])
  })

  it('tries TLS with MariaDB’s client on "prefer" and can retry without it', () => {
    const { runs, withoutTls } = mysqldumpRuns(
      { tool: MARIADB_DUMP, target: mysql, request: request() },
      null
    )
    expect(runs[0]!.args).toEqual(
      expect.arrayContaining(['--ssl', '--skip-ssl-verify-server-cert'])
    )
    expect(runs[0]!.args).not.toContain('--set-gtid-purged=OFF')
    expect(withoutTls?.(runs[0]!.args)).toEqual(expect.arrayContaining(['--skip-ssl']))
    expect(withoutTls?.(runs[0]!.args)).not.toContain('--ssl')
  })

  it('refuses to verify a certificate through a tunnel', () => {
    expect(() =>
      mysqldumpRuns(
        {
          tool: MYSQLDUMP,
          target: target({
            driver: 'mysql',
            host: '127.0.0.1',
            sslMode: 'verify-full',
            tlsServerName: 'db'
          }),
          request: request()
        },
        null
      )
    ).toThrow(/through an SSH tunnel/)
  })

  it('writes a password any option file reads back', () => {
    expect(mysqlOptionFileText('a"b\\c#d\ne')).toBe('[client]\npassword="a\\"b\\\\c#d\\ne"\n')
  })
})
