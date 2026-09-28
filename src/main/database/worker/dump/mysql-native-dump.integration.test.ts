import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../shared/database/database-dump-types'
import { runProcess } from '../../../../shared/child-process/run-process'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { connectMysqlClient, endMysqlClient, queryMysqlRows } from '../mysql-client-factory'
import { dumpObjects, fixture, SERVERS, snapshot } from './mysql-dump-test-fixture'
import { mysqlOptionFile } from './native/mysqldump-plan'
import { runNativeDump } from './native/native-dump-job'
import type { NativeDumpTarget } from './native/native-dump-plan'
import { findDumpTool } from './native/native-dump-tools'

// Opt-in through ORCA_TEST_MYSQL_URL / ORCA_TEST_MARIADB_URL, and runs only where mysqldump (and
// the mysql client beside it) is installed.

const tool = await findDumpTool({ driver: 'mysql', serverVersion: '' })
const dir = mkdtempSync(join(tmpdir(), 'orca-mysql-native-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 100,
  dropExisting: false,
  engine: 'native'
}

describe.each(SERVERS)('$label dump with mysqldump', ({ url }) => {
  const database = `orca_native_${randomUUID().slice(0, 8)}`
  const server = url ? serverConnectionFromUrl('mysql', url) : null
  const connection = server?.connection.driver === 'mysql' ? server.connection : null
  const created: string[] = [database]
  let target: NativeDumpTarget | null = null

  const dump = async (changes: Partial<DatabaseDumpOptions>, path: string) =>
    runNativeDump({
      target,
      request: {
        objects: dumpObjects(database),
        completeSchemas: [database],
        options: { ...OPTIONS, ...changes }
      },
      destination:
        changes.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
      onProgress: () => undefined,
      isCancelled: () => false,
      onStop: () => undefined
    })

  /** Loads the files with the mysql client beside mysqldump, as a user would. */
  const restore = async (files: string[]): Promise<string> => {
    const into = `orca_native_target_${randomUUID().slice(0, 8)}`
    created.push(into)
    await runAdminSql(server!, [`create database ${into}`])
    const options = join(dir, `${into}.cnf`)
    writeFileSync(options, mysqlOptionFile(server!.password ?? ''), { mode: 0o600 })
    for (const file of files) {
      const result = await runProcess({
        program: join(dirname(tool!.path), tool!.flavor === 'mariadb' ? 'mariadb' : 'mysql'),
        args: [
          `--defaults-extra-file=${options}`,
          `--host=${connection!.host}`,
          `--port=${connection!.port}`,
          `--user=${connection!.user}`,
          '--protocol=TCP',
          ...(tool!.flavor === 'mariadb'
            ? ['--skip-ssl']
            : ['--ssl-mode=DISABLED', '--get-server-public-key']),
          into
        ],
        input: readFileSync(file, 'utf8'),
        timeoutMs: 60_000
      })
      if (result.code !== 0) {
        throw new Error(`mysql failed on ${file}: ${result.stderr}`)
      }
    }
    return into
  }

  beforeAll(async () => {
    if (!server || !connection || !tool) {
      return
    }
    await runAdminSql(server, fixture(database))
    const client = await connectMysqlClient(connection, server.password, () => undefined)
    const [row] = await queryMysqlRows(client, 'select version() as version')
    await endMysqlClient(client)
    target = { connection, password: server.password, serverVersion: String(row?.version ?? '') }
  })

  afterAll(async () => {
    if (server) {
      await runAdminSql(
        server,
        created.map((name) => `drop database if exists ${name}`),
        { ignoreErrors: true }
      )
    }
  })

  it.skipIf(!url || !tool)(
    'restores the same tables, rows, views, routines and triggers',
    async () => {
      const summary = await dump({}, join(dir, `${database}.sql`))
      expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: null })
      const into = await restore(summary.files)
      expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
    }
  )

  it.skipIf(!url || !tool)(
    'restores a file per table, one row per INSERT, twice over',
    async () => {
      const summary = await dump(
        { layout: 'file-per-table', rowsPerInsert: 1, dropExisting: true },
        join(dir, `${database}-files`)
      )
      expect(summary.files.map((file) => file.split(/[/\\]/).pop())).toEqual(
        ['people', 'orders', 'a', 'b', 'views', 'routines'].map(
          (name, index) => `00${index}_${database}.${name}.sql`
        )
      )
      // One INSERT for each of people's three rows.
      expect(
        readFileSync(summary.files[0]!, 'utf8').match(/^INSERT INTO `people` /gm)
      ).toHaveLength(3)
      const into = await restore(summary.files)
      await restore(summary.files)
      expect(await snapshot(url!, into)).toEqual(await snapshot(url!, database))
    }
  )
})
