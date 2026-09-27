import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../shared/database/database-dump-types'
import { DumpOutput } from './dump-output'
import { runDump } from './dump-runner'
import { SqliteDumpSource } from './sqlite-dump-source'

const dir = mkdtempSync(join(tmpdir(), 'orca-sqlite-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const source = join(dir, 'source.db')
const seed = new DatabaseSync(source, { enableForeignKeyConstraints: false })
seed.exec(`
  create table people (
    id integer primary key autoincrement, name text not null, photo blob, score real,
    big integer, doubled integer generated always as (id * 2) stored);
  create table orders (id integer primary key, person_id integer not null references people (id), code text unique);
  create index orders_person_idx on orders (person_id);
  create table a (id integer primary key, b_id integer references b (id));
  create table b (id integer primary key, a_id integer references a (id));
  insert into people (name, photo, score, big) values
    ('Ada', x'00ff10', 1.5, 9007199254740993),
    ('Bob''s' || char(10) || 'line\\slash 中文 🎉', x'', 9e999, -9223372036854775808),
    ('Cy', null, -0.000001, null);
  delete from people where name = 'Cy';
  insert into orders (person_id, code) values (1, 'a1'), (2, null);
  insert into a values (1, 10), (2, null);
  insert into b values (10, 1), (20, 2);
  create view people_view as select id, name from people;
  create view people_view_ids as select id from people_view;
  create trigger orders_upper after insert on orders begin update orders set code = upper(code) where id = new.id; end;
`)
seed.close()

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 2,
  dropExisting: false
}

function snapshot(path: string): Record<string, unknown> {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = (sql: string) => {
      const statement = database.prepare(sql)
      statement.setReadBigInts(true)
      return statement.all()
    }
    return {
      objects: rows(
        "select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' order by name"
      ),
      sequences: rows('select name, seq from sqlite_sequence order by name'),
      ...Object.fromEntries(
        ['people', 'orders', 'a', 'b', 'people_view', 'people_view_ids'].map((name) => [
          name,
          rows(`select * from ${name} order by 1`)
        ])
      )
    }
  } finally {
    database.close()
  }
}

async function dump(options: Partial<DatabaseDumpOptions>, path: string) {
  const database = new DatabaseSync(source, { readOnly: true })
  const dumpSource = new SqliteDumpSource(database)
  try {
    return await runDump({
      source: dumpSource,
      request: {
        objects: [
          ...['people', 'orders', 'a', 'b'].map((name) => ({
            kind: 'table' as const,
            schema: 'main',
            name
          })),
          { kind: 'view', schema: 'main', name: 'people_view_ids' },
          { kind: 'view', schema: 'main', name: 'people_view' }
        ],
        options: { ...OPTIONS, ...options }
      },
      output: new DumpOutput(
        options.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
        'sqlite'
      ),
      onProgress: () => undefined,
      isCancelled: () => false
    })
  } finally {
    await dumpSource.close()
  }
}

function restore(files: readonly string[], name: string): string {
  const path = join(dir, name)
  const database = new DatabaseSync(path)
  for (const file of files) {
    database.exec(readFileSync(file, 'utf8'))
  }
  database.close()
  return path
}

describe('SQLite dump', () => {
  it('restores the same objects, rows and AUTOINCREMENT counters', async () => {
    const summary = await dump({}, join(dir, 'all.sql'))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: 8 })
    expect(snapshot(restore(summary.files, 'all.db'))).toEqual(snapshot(source))
  })

  it('restores from a file per table, and from structure then data', async () => {
    const folder = join(dir, 'files')
    const perTable = await dump({ layout: 'file-per-table', dropExisting: true }, folder)
    expect(snapshot(restore(perTable.files, 'files.db'))).toEqual(snapshot(source))

    const structure = await dump({ contents: 'structure' }, join(dir, 'structure.sql'))
    const data = await dump({ contents: 'data' }, join(dir, 'data.sql'))
    expect(readFileSync(data.files[0]!, 'utf8')).not.toMatch(/CREATE TABLE/i)
    // Loading rows into a structure that already has its triggers fires them (SQLite can't
    // switch them off), so orders' codes come back upper-cased; everything else matches.
    const { orders: loaded, ...split } = snapshot(
      restore([...structure.files, ...data.files], 'split.db')
    )
    const { orders: original, ...expected } = snapshot(source)
    expect(split).toEqual(expected)
    expect(loaded).toHaveLength(Array.isArray(original) ? original.length : -1)
  })
})
