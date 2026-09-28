import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../shared/database/database-dump-types'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { connectPostgresClient } from '../postgres-client-factory'
import { DumpOutput } from './dump-output'
import { runDump } from './dump-runner'
import { PostgresDumpSource } from './postgres-dump-source'
import {
  FIXTURE,
  OBJECTS,
  OPTIONS,
  schema,
  sequenceDefinitions,
  snapshot,
  url
} from './postgres-dump-test-fixture'

// Opt-in through ORCA_TEST_POSTGRES_URL; the role must be allowed to create a database.

const dir = mkdtempSync(join(tmpdir(), 'orca-pg-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!url)('PostgreSQL dump', () => {
  const target = url ? serverConnectionFromUrl('postgres', url) : null
  const sourceDatabase =
    target?.connection.driver === 'postgres' ? target.connection.database || 'postgres' : 'postgres'
  const restored: string[] = []

  const dump = async (options: Partial<DatabaseDumpOptions>, path: string) => {
    if (target?.connection.driver !== 'postgres') {
      throw new Error('no PostgreSQL target')
    }
    const client = await connectPostgresClient(target.connection, target.password, () => undefined)
    const source = new PostgresDumpSource(client, 170_000)
    try {
      return await runDump({
        source,
        request: { objects: OBJECTS, options: { ...OPTIONS, ...options } },
        output: new DumpOutput(
          options.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
          'postgres'
        ),
        onProgress: () => undefined,
        isCancelled: () => false
      })
    } finally {
      await source.close()
    }
  }

  /** A new database, with `setup` run in it. */
  const newDatabase = async (setup: string[] = []): Promise<string> => {
    const database = `orca_dump_target_${randomUUID().slice(0, 8)}`
    restored.push(database)
    await runAdminSql(target!, [`create database ${database}`])
    await runAdminSql(target!, setup, { database })
    return database
  }

  const load = async (database: string, files: string[]): Promise<void> => {
    for (const file of files) {
      await runAdminSql(target!, [readFileSync(file, 'utf8')], { database })
    }
  }

  const restore = async (files: string[]): Promise<string> => {
    const database = await newDatabase()
    await load(database, files)
    return database
  }

  beforeAll(async () => {
    await runAdminSql(target!, FIXTURE)
  })

  afterAll(async () => {
    await runAdminSql(target!, [`drop schema if exists ${schema} cascade`], { ignoreErrors: true })
    for (const database of restored) {
      await runAdminSql(target!, [`drop database if exists ${database} with (force)`], {
        ignoreErrors: true
      })
    }
  })

  it('restores the same tables, rows, sequences, views, routines and triggers', async () => {
    const summary = await dump({}, join(dir, 'all.sql'))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: 10 })
    const database = await restore(summary.files)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })

  it('restores from a file per table, run in name order, with foreign keys left inline', async () => {
    const folder = join(dir, 'per-table')
    const summary = await dump({ layout: 'file-per-table', disableForeignKeys: false }, folder)
    const files = readdirSync(folder)
      .sort()
      .map((name) => join(folder, name))
    expect(files).toEqual(summary.files)
    // a and b reference each other, so their keys still wait for the finish file.
    expect(summary.notes.join(' ')).toMatch(/cycle/)
    const database = await restore(files)
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })

  it('replaces a sequence the target defines otherwise, or stops when it can’t', async () => {
    const replacing = await dump({ dropExisting: true }, join(dir, 'replacing.sql'))
    const keeping = await dump({}, join(dir, 'keeping.sql'))
    // Another type, step, range, cycling and cache than the source's people_id_seq, owned by
    // no table the dump drops.
    const differing = [
      `create schema ${schema}`,
      `create sequence ${schema}.people_id_seq as bigint
         increment by 3 minvalue -100 maxvalue 100000 cache 4 cycle`
    ]
    const refused = /people_id_seq"? already exists with a definition other than the dumped one/

    const replaced = await newDatabase(differing)
    await load(replaced, replacing.files)
    expect(await snapshot(replaced)).toEqual(await snapshot(sourceDatabase))

    const shared = await newDatabase([
      ...differing,
      `create table ${schema}.elsewhere (id bigint default nextval('${schema}.people_id_seq'))`
    ])
    const asTheTargetHadIt = await sequenceDefinitions(shared)
    await expect(load(shared, replacing.files)).rejects.toThrow(refused)
    expect(await sequenceDefinitions(shared)).toEqual(asTheTargetHadIt)

    const kept = await newDatabase(differing)
    await expect(load(kept, keeping.files)).rejects.toThrow(refused)
    expect(await sequenceDefinitions(kept)).toEqual(asTheTargetHadIt)
  })

  it('exports only rows, loading into the same structure', async () => {
    const structure = await dump({ contents: 'structure' }, join(dir, 'structure.sql'))
    const data = await dump({ contents: 'data' }, join(dir, 'data.sql'))
    expect(readFileSync(data.files[0]!, 'utf8')).not.toMatch(/CREATE TABLE/)
    const database = await restore([...structure.files, ...data.files])
    expect(await snapshot(database)).toEqual(await snapshot(sourceDatabase))
  })
})
