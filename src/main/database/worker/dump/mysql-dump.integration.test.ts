import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../shared/database/database-dump-types'
import { splitSqlStatements } from '../../../../shared/database/sql-statement-splitter'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { connectMysqlClient } from '../mysql-client-factory'
import { DumpOutput } from './dump-output'
import { dumpObjects, fixture, SERVERS, snapshot } from './mysql-dump-test-fixture'
import { runDump } from './dump-runner'
import { MysqlDumpSource } from './mysql-dump-source'

// Opt-in through ORCA_TEST_MYSQL_URL / ORCA_TEST_MARIADB_URL; the user must create databases.

const dir = mkdtempSync(join(tmpdir(), 'orca-mysql-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.each(SERVERS)('$label dump', ({ url }) => {
  const database = `orca_dump_${randomUUID().slice(0, 8)}`
  const target = url ? serverConnectionFromUrl('mysql', url) : null
  const created: string[] = [database]
  const objects = dumpObjects(database)
  const options: DatabaseDumpOptions = {
    contents: 'structure-and-data',
    disableForeignKeys: true,
    layout: 'single-file',
    rowsPerInsert: 2,
    dropExisting: false
  }

  const dump = async (changes: Partial<DatabaseDumpOptions>, path: string) => {
    if (target?.connection.driver !== 'mysql') {
      throw new Error('no MySQL target')
    }
    const client = await connectMysqlClient(target.connection, target.password, () => undefined)
    const source = new MysqlDumpSource(client)
    try {
      return await runDump({
        source,
        request: { objects, options: { ...options, ...changes } },
        output: new DumpOutput(
          changes.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
          'mysql'
        ),
        onProgress: () => undefined,
        isCancelled: () => false
      })
    } finally {
      await source.close()
    }
  }

  /** Loads dump files into a new database, statement by statement as a client would. */
  const restore = async (files: string[]): Promise<string> => {
    const into = `orca_dump_target_${randomUUID().slice(0, 8)}`
    created.push(into)
    await runAdminSql(target!, [`create database ${into}`])
    const statements = files.flatMap((file) =>
      splitSqlStatements(readFileSync(file, 'utf8'), 'mysql').map((statement) => statement.text)
    )
    await runAdminSql(target!, statements, { database: into })
    return into
  }

  beforeAll(async () => {
    if (target) {
      await runAdminSql(target, fixture(database))
    }
  })

  afterAll(async () => {
    if (target) {
      await runAdminSql(
        target,
        created.map((name) => `drop database if exists ${name}`),
        { ignoreErrors: true }
      )
    }
  })

  it.skipIf(!url)('restores the same tables, rows, views, routines and triggers', async () => {
    const summary = await dump({}, join(dir, `${database}.sql`))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: 10 })
    const into = await restore(summary.files)
    expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
  })

  it.skipIf(!url)('restores from a file per table with foreign key checks left on', async () => {
    const folder = join(dir, `${database}-files`)
    const summary = await dump(
      { layout: 'file-per-table', disableForeignKeys: false, dropExisting: true },
      folder
    )
    expect(
      readdirSync(folder)
        .sort()
        .map((name) => join(folder, name))
    ).toEqual(summary.files)
    const into = await restore(summary.files)
    expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
  })
})
