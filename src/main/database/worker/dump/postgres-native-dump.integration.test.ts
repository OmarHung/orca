import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../shared/database/database-dump-types'
import { runProcess } from '../../../../shared/child-process/run-process'
import { runAdminSql } from '../database-test-admin'
import { connectPostgresClient } from '../postgres-client-factory'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { runNativeDump } from './native/native-dump-job'
import type { NativeDumpTarget } from './native/native-dump-plan'
import { findDumpTool } from './native/native-dump-tools'
import { FIXTURE, OBJECTS, OPTIONS, schema, snapshot, url } from './postgres-dump-test-fixture'

// Opt-in through ORCA_TEST_POSTGRES_URL, and runs only where pg_dump (and psql beside it) is
// installed; the role must be allowed to create a database.

const tool = url ? await findDumpTool({ driver: 'postgres', serverVersion: '0' }) : null
const dir = mkdtempSync(join(tmpdir(), 'orca-pg-native-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!tool)('PostgreSQL dump with pg_dump', () => {
  const server = serverConnectionFromUrl('postgres', url!)
  const connection = server.connection.driver === 'postgres' ? server.connection : null
  const sourceDatabase = connection?.database || 'postgres'
  const restored: string[] = []
  let target: NativeDumpTarget | null = null

  const dump = async (options: Partial<DatabaseDumpOptions>, path: string) =>
    runNativeDump({
      target,
      request: {
        objects: OBJECTS,
        completeSchemas: [schema],
        options: { ...OPTIONS, ...options, engine: 'native' }
      },
      destination:
        options.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
      onProgress: () => undefined,
      isCancelled: () => false,
      onStop: () => undefined
    })

  /** Loads the files with psql, as a user would, stopping at the first error. */
  const psql = async (files: string[], database: string): Promise<void> => {
    for (const file of files) {
      const result = await runProcess({
        program: join(dirname(tool!.path), process.platform === 'win32' ? 'psql.exe' : 'psql'),
        args: [
          '--no-psqlrc',
          '--quiet',
          '-v',
          'ON_ERROR_STOP=1',
          `--host=${connection!.host}`,
          `--port=${connection!.port}`,
          `--username=${connection!.user}`,
          `--dbname=${database}`,
          `--file=${file}`
        ],
        env: { ...process.env, PGPASSWORD: server.password ?? '' },
        timeoutMs: 60_000
      })
      if (result.code !== 0) {
        throw new Error(`psql failed on ${file}: ${result.stderr}`)
      }
    }
  }

  const newDatabase = async (): Promise<string> => {
    const database = `orca_native_target_${randomUUID().slice(0, 8)}`
    restored.push(database)
    await runAdminSql(server, [`create database ${database}`])
    return database
  }

  beforeAll(async () => {
    await runAdminSql(server, FIXTURE)
    const client = await connectPostgresClient(connection!, server.password, () => undefined)
    const version = await client.query<{ server_version: string }>('show server_version')
    await client.end()
    target = {
      connection: connection!,
      password: server.password,
      serverVersion: version.rows[0]?.server_version ?? '0'
    }
  })

  afterAll(async () => {
    await runAdminSql(server, [`drop schema if exists ${schema} cascade`], { ignoreErrors: true })
    for (const database of restored) {
      await runAdminSql(server, [`drop database if exists ${database} with (force)`], {
        ignoreErrors: true
      })
    }
  })

  it('restores the same schema, rows, sequences, views, routines and triggers', async () => {
    const summary = await dump({}, join(dir, 'all.sql'))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: null, notes: [] })
    expect(readFileSync(summary.files[0]!, 'utf8')).toMatch(/INSERT INTO/)
    const database = await newDatabase()
    await psql(summary.files, database)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })

  it('restores a file per table twice over, dropping what the first load made', async () => {
    const summary = await dump(
      { layout: 'file-per-table', dropExisting: true },
      join(dir, 'per-table')
    )
    expect(summary.files.map((file) => file.split(/[/\\]/).pop())).toEqual([
      '000_setup.sql',
      ...['people', 'orders', 'a', 'b'].map(
        (name, index) => `00${index + 1}_${schema}.${name}.sql`
      ),
      '005_finish.sql'
    ])
    const database = await newDatabase()
    await psql(summary.files, database)
    await psql(summary.files, database)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })

  it('exports only rows into the same structure, with triggers off while they load', async () => {
    const structure = await dump({ contents: 'structure' }, join(dir, 'structure.sql'))
    const data = await dump({ contents: 'data' }, join(dir, 'data.sql'))
    expect(readFileSync(data.files[0]!, 'utf8')).not.toMatch(/CREATE TABLE/)
    expect(data.notes.join(' ')).toMatch(/disable-triggers/)
    const database = await newDatabase()
    await psql([...structure.files, ...data.files], database)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })
})
