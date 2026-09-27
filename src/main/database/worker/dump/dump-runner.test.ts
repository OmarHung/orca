import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type {
  DatabaseDumpOptions,
  DatabaseDumpRequest
} from '../../../../shared/database/database-dump-types'
import { DumpOutput } from './dump-output'
import { runDump } from './dump-runner'
import type { DumpSource } from './dump-source'

const dir = mkdtempSync(join(tmpdir(), 'orca-dump-runner-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const REFERENCES: Record<string, string[]> = { orders: ['people'], people: [] }
const ROWS: Record<string, string[][]> = {
  people: [
    ['1', "'Ada'"],
    ['2', "'Bob'"],
    ['3', "'Cy'"]
  ],
  orders: [['10', '1']]
}

/** A PostgreSQL-shaped source over two tables (orders → people), a view and a function. */
function fakeSource(options: { onRows?: () => void } = {}): DumpSource {
  return {
    dialect: 'postgres',
    notes: [],
    begin: async () => undefined,
    end: async () => undefined,
    close: async () => undefined,
    settings: ({ foreignKeyChecksOff }: { foreignKeyChecksOff: boolean }) => ({
      before: [{ sql: `SET checks = ${foreignKeyChecksOff ? 'off' : 'on'}` }],
      after: [{ sql: 'RESET checks' }]
    }),
    createSchema: (schema) => [{ sql: `CREATE SCHEMA IF NOT EXISTS ${schema}` }],
    enterSchema: () => [],
    tableInfo: async ({ schema, name }) => ({
      schema,
      name,
      sqlName: `${schema}.${name}`,
      columns: ['id', 'x'],
      explicitIdentity: name === 'people',
      references: (REFERENCES[name] ?? []).map((reference) => ({ schema, name: reference }))
    }),
    tableStructure: async (table, separateForeignKeys) => ({
      requires: [{ sql: 'CREATE TYPE mood' }],
      create: [
        {
          sql: `CREATE TABLE ${table.sqlName} (${separateForeignKeys || table.name === 'people' ? '' : 'FK'})`
        }
      ],
      foreignKeys:
        separateForeignKeys && table.name === 'orders'
          ? [{ sql: 'ALTER TABLE s.orders ADD FK' }]
          : [],
      triggers: table.name === 'orders' ? [{ sql: 'CREATE TRIGGER t' }] : []
    }),
    async *rows(table, batchSize) {
      const rows = ROWS[table.name] ?? []
      for (let index = 0; index < rows.length; index += batchSize) {
        options.onRows?.()
        yield rows.slice(index, index + batchSize)
      }
    },
    beforeRows: () => [],
    afterRows: async (table) => (table.name === 'people' ? [{ sql: 'SELECT setval(3)' }] : []),
    view: async ({ schema, name }) => ({
      definition: 'select * from s.orders',
      create: [{ sql: `CREATE VIEW ${schema}.${name}` }],
      drop: { sql: `DROP VIEW IF EXISTS ${schema}.${name}` }
    }),
    routine: async (routine) => ({
      create: { sql: `CREATE FUNCTION ${routine.identity}` },
      drop: { sql: `DROP FUNCTION IF EXISTS ${routine.identity}` }
    }),
    dropTables: (tables) => [
      { sql: `DROP TABLE IF EXISTS ${tables.map((table) => table.sqlName).join(', ')}` }
    ],
    cancel: () => undefined
  }
}

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: false,
  layout: 'single-file',
  rowsPerInsert: 2,
  dropExisting: false
}

function request(options: Partial<DatabaseDumpOptions> = {}): DatabaseDumpRequest {
  return {
    objects: [
      { kind: 'table', schema: 's', name: 'orders' },
      { kind: 'table', schema: 's', name: 'people' },
      { kind: 'view', schema: 's', name: 'recent' },
      { kind: 'routine', schema: 's', name: 'f', identity: 's.f()', routineKind: 'function' }
    ],
    options: { ...OPTIONS, ...options }
  }
}

function statements(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line && !line.startsWith('--'))
    .map((line) => line.replace(/;$/, ''))
}

describe('runDump', () => {
  it('writes setup, tables in reference order with their rows, then views, routines and triggers', async () => {
    const path = join(dir, 'single.sql')
    const summary = await runDump({
      source: fakeSource(),
      request: request({ dropExisting: true }),
      output: new DumpOutput({ kind: 'file', path }, 'postgres'),
      onProgress: () => undefined,
      isCancelled: () => false
    })
    expect(summary).toMatchObject({ cancelled: false, files: [path], tables: 2, rows: 4 })
    expect(summary.bytes).toBe(readFileSync(path).length)
    expect(statements(readFileSync(path, 'utf8'))).toEqual([
      'SET checks = on',
      'CREATE SCHEMA IF NOT EXISTS s',
      'DROP VIEW IF EXISTS s.recent',
      'DROP FUNCTION IF EXISTS s.f()',
      'DROP TABLE IF EXISTS s.orders, s.people',
      'CREATE TYPE mood',
      'CREATE TABLE s.people ()',
      'INSERT INTO s.people (id, x) OVERRIDING SYSTEM VALUE VALUES',
      "(1, 'Ada'),",
      "(2, 'Bob')",
      'INSERT INTO s.people (id, x) OVERRIDING SYSTEM VALUE VALUES',
      "(3, 'Cy')",
      'SELECT setval(3)',
      'CREATE TABLE s.orders (FK)',
      'INSERT INTO s.orders (id, x) VALUES',
      '(10, 1)',
      'CREATE VIEW s.recent',
      'CREATE FUNCTION s.f()',
      'CREATE TRIGGER t',
      'RESET checks'
    ])
  })

  it('keeps foreign keys apart when asked to switch checks off, and writes a file per table', async () => {
    const folder = join(dir, 'per-table')
    const summary = await runDump({
      source: fakeSource(),
      request: request({ layout: 'file-per-table', disableForeignKeys: true }),
      output: new DumpOutput({ kind: 'folder', path: folder }, 'postgres'),
      onProgress: () => undefined,
      isCancelled: () => false
    })
    expect(readdirSync(folder)).toEqual([
      '000_setup.sql',
      '001_s.people.sql',
      '002_s.orders.sql',
      '003_finish.sql'
    ])
    expect(summary.files).toHaveLength(4)
    const orders = statements(readFileSync(join(folder, '002_s.orders.sql'), 'utf8'))
    // Every file stands alone: it opens and closes its own session settings.
    expect(orders[0]).toBe('SET checks = off')
    expect(orders).toContain('CREATE TABLE s.orders ()')
    expect(orders.at(-1)).toBe('RESET checks')
    const finish = statements(readFileSync(join(folder, '003_finish.sql'), 'utf8'))
    expect(finish).toContain('ALTER TABLE s.orders ADD FK')
  })

  it('writes only rows for a data export', async () => {
    const path = join(dir, 'data.sql')
    await runDump({
      source: fakeSource(),
      request: request({ contents: 'data', rowsPerInsert: 10 }),
      output: new DumpOutput({ kind: 'file', path }, 'postgres'),
      onProgress: () => undefined,
      isCancelled: () => false
    })
    const text = readFileSync(path, 'utf8')
    expect(text).not.toMatch(/CREATE|DROP/)
    expect(text).toMatch(/INSERT INTO s\.people/)
  })

  it('removes what it wrote when cancelled', async () => {
    const path = join(dir, 'cancelled.sql')
    let batches = 0
    const summary = await runDump({
      source: fakeSource({ onRows: () => (batches += 1) }),
      request: request(),
      output: new DumpOutput({ kind: 'file', path }, 'postgres'),
      onProgress: () => undefined,
      isCancelled: () => batches > 1
    })
    expect(summary).toMatchObject({ cancelled: true, files: [] })
    expect(existsSync(path)).toBe(false)
  })
})
