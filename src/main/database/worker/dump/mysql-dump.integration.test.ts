import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../shared/database/database-dump-types'
import { splitSqlStatements } from '../../../../shared/database/sql-statement-splitter'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { connectMysqlClient, queryMysqlRows } from '../mysql-client-factory'
import { DumpOutput } from './dump-output'
import {
  contextBehaviour,
  contextFixture,
  contextObjects,
  dumpObjects,
  fixture,
  mysqlAt,
  SERVERS,
  snapshot
} from './mysql-dump-test-fixture'
import { runDump } from './dump-runner'
import { MysqlDumpSource } from './mysql-dump-source'

// Opt-in through ORCA_TEST_MYSQL_URL / ORCA_TEST_MARIADB_URL; the user must create databases.

const dir = mkdtempSync(join(tmpdir(), 'orca-mysql-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// A loading session unlike the dump's own in every setting the dump changes.
const LOADING_SESSION = `SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES', time_zone = '+05:00',
  character_set_client = latin1, character_set_results = latin1, collation_connection = latin1_german2_ci`
const SESSION_SETTINGS = `select @@sql_mode as sql_mode, @@time_zone as time_zone,
  @@character_set_client as client, @@character_set_results as results,
  @@collation_connection as connection, @@foreign_key_checks as foreign_key_checks`

describe.each(SERVERS)('$label dump', ({ url }) => {
  const database = `orca_dump_${randomUUID().slice(0, 8)}`
  const target = url ? serverConnectionFromUrl('mysql', url) : null
  const created: string[] = [database]
  const objects = [...dumpObjects(database), ...contextObjects(database)]
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
    // As on a server whose default mode would have SHOW CREATE quote names in double quotes.
    await queryMysqlRows(client, "SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'")
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

  /**
   * Loads dump files into a new database made like the source is now, statement by statement
   * on one session as a client would, and checks the session ends as it began.
   */
  const restore = async (files: string[]): Promise<string> => {
    const into = `orca_dump_target_${randomUUID().slice(0, 8)}`
    created.push(into)
    await runAdminSql(target!, [`create database ${into} collate utf8mb4_bin`])
    const client = await mysqlAt(url!, into)
    try {
      await client.query(LOADING_SESSION)
      const [before] = await client.query(SESSION_SETTINGS)
      for (const file of files) {
        for (const statement of splitSqlStatements(readFileSync(file, 'utf8'), 'mysql')) {
          await client.query(statement.text)
        }
      }
      const [after] = await client.query(SESSION_SETTINGS)
      expect(after).toEqual(before)
    } finally {
      await client.end()
    }
    return into
  }

  beforeAll(async () => {
    if (target) {
      await runAdminSql(target, [...fixture(database), ...contextFixture(database)])
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
    expect(summary).toMatchObject({ cancelled: false, tables: 5, rows: 10 })
    const into = await restore(summary.files)
    expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
  })

  it.skipIf(!url)('rebuilds stored objects in the session they were made in', async () => {
    const summary = await dump({}, join(dir, `${database}-context.sql`))
    expect(summary.notes.join(' ')).toMatch(/then to utf8mb4_bin/)
    // The mysql client needs its own delimiter around a trigger's BEGIN … END.
    expect(readFileSync(summary.files[0]!, 'utf8')).toMatch(
      /DELIMITER ;;\nCREATE TRIGGER [`"]notes_tab[`"][^;]*;[^;]*;\s*end;;\nDELIMITER ;/i
    )
    const into = await restore(summary.files)
    const behaviour = await contextBehaviour(url!, database)
    // Read under their own modes: a double-quoted name, a backslash kept as written.
    expect(behaviour).toEqual({
      values: [
        {
          quoted: 'a\\b|z',
          literal: 'latin1_german2_ci',
          local: expect.not.stringMatching(/^utf8mb4_bin$/),
          view: 'latin1_german2_ci'
        }
      ],
      path: [{ path: 'x\\y' }],
      note: [{ body: 'n\\t' }]
    })
    expect(await contextBehaviour(url!, into)).toEqual(behaviour)
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
