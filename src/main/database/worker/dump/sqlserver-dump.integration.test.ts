import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Request } from 'tedious'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  DatabaseDumpObject,
  DatabaseDumpOptions
} from '../../../../shared/database/database-dump-types'
import { splitSqlBatches } from '../../../../shared/database/sql-statement-splitter'
import { runAdminSql } from '../database-test-admin'
import { serverConnectionFromUrl } from '../database-worker-test-harness'
import { closeSqlServer, connectSqlServer, querySqlServerRows } from '../sqlserver-client-factory'
import { DumpOutput } from './dump-output'
import { runDump } from './dump-runner'
import { SqlServerDumpSource } from './sqlserver-dump-source'
import { streamSqlServerRows } from './sqlserver-row-stream'

// Opt-in through ORCA_TEST_SQLSERVER_URL; the login must be allowed to create a database.

const url = process.env.ORCA_TEST_SQLSERVER_URL
const dir = mkdtempSync(join(tmpdir(), 'orca-mssql-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const source = `orca_dump_${randomUUID().slice(0, 8)}`

const FIXTURE = [
  'create schema sales',
  'create type dbo.code_text from nvarchar(20) not null',
  // Sequences behind defaults: one two tables share, one cycling past its end, one used up,
  // and one never used whose type only the sequence names.
  'create type dbo.ticket from int not null',
  `create sequence sales.order_numbers as bigint
     start with 1000 increment by 10 minvalue 1000 maxvalue 99999 no cycle cache 20`,
  `create sequence dbo.countdown as decimal(12, 0)
     start with -5 increment by -2 minvalue -9 maxvalue 0 cycle no cache`,
  'create sequence dbo.levels as tinyint start with 1 minvalue 1 maxvalue 3',
  'create sequence dbo.later as dbo.ticket start with 7',
  `create table dbo.people (
     id int identity(1, 1) primary key,
     name nvarchar(100) not null constraint people_name_df default N'?',
     latin varchar(50) collate Latin1_General_CS_AS null, photo varbinary(max) null,
     amount decimal(30, 10) null constraint people_amount_ck check (amount > -1),
     price money null, score float null, ratio real null, born date null, seen datetime2(7) null,
     legacy datetime null, at datetimeoffset(7) null, t time(7) null, flag bit null,
     big bigint null, guid uniqueidentifier null, doc xml null, code dbo.code_text null,
     doubled as (amount * 2), version rowversion)`,
  `create table sales.orders (
     id int identity(10, 5) primary key nonclustered, person_id int not null,
     code nvarchar(20) null,
     number bigint not null constraint orders_number_df default (next value for sales.order_numbers),
     constraint orders_person_fk foreign key (person_id) references dbo.people (id) on delete cascade)`,
  'create clustered index orders_code_idx on sales.orders (code desc)',
  'create index orders_person_idx on sales.orders (person_id) include (code) where code is not null',
  `create table dbo.a (id int primary key, b_id int null,
     n bigint not null constraint a_n_df default (next value for sales.order_numbers),
     level tinyint null constraint a_level_df default (next value for dbo.levels))`,
  `create table dbo.b (id int primary key, a_id int null references dbo.a (id),
     later int null constraint b_later_df default (next value for dbo.later),
     countdown decimal(12, 0) null constraint b_countdown_df default (next value for dbo.countdown))`,
  'alter table dbo.a add constraint a_b_fk foreign key (b_id) references dbo.b (id)',
  `insert into dbo.people
     (name, latin, photo, amount, price, score, ratio, born, seen, legacy, at, t, flag, big, guid, doc, code)
   values
     (N'Ada', 'Ab', 0x00ff10, 12345678901234567890.1234567891, 922337203685477.5807, 0.1, 0.1,
      '2024-02-29', '2026-09-28T12:34:56.1234567', '2026-09-28T12:34:56.997',
      '2026-09-28T12:34:56.1234567+05:30', '23:59:59.9999999', 1, -9223372036854775808,
      'D3B07384-D9A0-4C9B-8F3E-2D6A1F0B9C11', N'<a x="1">t</a>', N'c1'),
     (N'Bob''s' + nchar(10) + N'line\\' + nchar(13) + nchar(10) + N'next 中文 🎉 GO', null, 0x,
      -0.0000000001, -0.0001, 1.7976931348623157e308, -3.4e38, '0001-01-01', null, null, null,
      null, 0, 0, null, null, null),
     (N'Cy', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)`,
  // Why: the next identity value (4) must survive, not restart after the highest row left.
  "delete from dbo.people where name = N'Cy'",
  "insert into sales.orders (person_id, code) values (1, N'a1'), (2, N'b''2'), (1, null)",
  'insert into dbo.a (id, b_id) values (1, null), (2, null)',
  'declare @v sql_variant = next value for dbo.levels',
  'insert into dbo.b (id, a_id, later) values (10, 1, null), (20, 2, null)',
  // -5 and -7 went to b's rows; on past -9 to 0, then -2: the cycle has wrapped.
  `declare @v sql_variant = next value for dbo.countdown;
   set @v = next value for dbo.countdown; set @v = next value for dbo.countdown`,
  'update dbo.a set b_id = 10 where id = 1',
  'create view dbo.people_view as select id, name from dbo.people',
  'create view dbo.people_view_ids as select id from dbo.people_view',
  'create function dbo.add_one(@i int) returns int as begin return @i + 1 end',
  'create procedure sales.two_sets as begin select 1; select 2; end',
  `create trigger sales.orders_upper on sales.orders after insert as
   begin set nocount on; update o set code = upper(o.code) from sales.orders o join inserted i on i.id = o.id end`,
  'disable trigger sales.orders_upper on sales.orders',
  // Descriptions with quotes, a line break and characters past ASCII.
  `declare @people nvarchar(200) = N'People, it''s 50% 中文 🎉' + nchar(10) + N'next line';
   exec sys.sp_addextendedproperty N'MS_Description', @people, N'SCHEMA', N'dbo', N'TABLE', N'people'`,
  "exec sys.sp_addextendedproperty N'MS_Description', N'what they''re called', N'SCHEMA', N'dbo', N'TABLE', N'people', N'COLUMN', N'name'",
  "exec sys.sp_addextendedproperty N'MS_Description', N'the order code', N'SCHEMA', N'sales', N'TABLE', N'orders', N'COLUMN', N'code'",
  "exec sys.sp_addextendedproperty N'MS_Description', N'just names', N'SCHEMA', N'dbo', N'VIEW', N'people_view'",
  "exec sys.sp_addextendedproperty N'MS_Description', N'two result sets', N'SCHEMA', N'sales', N'PROCEDURE', N'two_sets'",
  "exec sys.sp_addextendedproperty N'MS_Description', N'adds one', N'SCHEMA', N'dbo', N'FUNCTION', N'add_one'"
]

const OBJECTS: DatabaseDumpObject[] = [
  ...['people', 'a', 'b'].map((name) => ({ kind: 'table' as const, schema: 'dbo', name })),
  { kind: 'table', schema: 'sales', name: 'orders' },
  { kind: 'view', schema: 'dbo', name: 'people_view_ids' },
  { kind: 'view', schema: 'dbo', name: 'people_view' },
  { kind: 'routine', schema: 'dbo', name: 'add_one', identity: 'add_one', routineKind: 'function' },
  {
    kind: 'routine',
    schema: 'sales',
    name: 'two_sets',
    identity: 'two_sets',
    routineKind: 'procedure'
  }
]

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 2,
  dropExisting: false
}

const CATALOG_QUERIES = {
  columns: `select object_schema_name(c.object_id) as s, object_name(c.object_id) as t, c.name,
              type_name(c.user_type_id) as type, c.max_length, c.precision, c.scale, c.is_nullable,
              c.is_identity, c.is_computed, c.collation_name
            from sys.columns c where objectproperty(c.object_id, 'IsUserTable') = 1
            order by s, t, c.column_id`,
  identities: `select object_name(object_id) as t, cast(seed_value as varchar(40)) as seed,
                 cast(increment_value as varchar(40)) as increment,
                 cast(last_value as varchar(40)) as last_value
               from sys.identity_columns where objectproperty(object_id, 'IsUserTable') = 1
               order by t`,
  indexes: `select object_name(i.object_id) as t, i.name, i.type_desc, i.is_unique, i.is_primary_key,
              i.filter_definition, c.name as col, ic.is_descending_key, ic.is_included_column
            from sys.indexes i
            join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
            join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
            where objectproperty(i.object_id, 'IsUserTable') = 1
            order by t, i.name, ic.index_column_id`,
  keys: `select name, object_name(parent_object_id) as t, delete_referential_action_desc,
           update_referential_action_desc, is_disabled from sys.foreign_keys order by name`,
  checks: 'select name, definition from sys.check_constraints order by name',
  defaults: 'select name, definition from sys.default_constraints order by name',
  objects: `select schema_name(schema_id) as s, name, type from sys.objects
            where type in ('V', 'FN', 'P', 'TR') order by s, name`,
  triggers: 'select name, is_disabled from sys.triggers order by name',
  types:
    'select schema_name(schema_id) as s, name, is_nullable from sys.types where is_user_defined = 1',
  comments: `select object_schema_name(major_id) as s, object_name(major_id) as o,
               col_name(major_id, minor_id) as c, cast(value as nvarchar(max)) as v
             from sys.extended_properties where class = 1 and name = N'MS_Description'
             order by s, o, minor_id`,
  sequences: `select schema_name(schema_id) as s, name, type_name(user_type_id) as type, precision,
                scale, cast(start_value as varchar(50)) as start_value,
                cast(increment as varchar(50)) as increment,
                cast(minimum_value as varchar(50)) as minimum_value,
                cast(maximum_value as varchar(50)) as maximum_value, is_cycling, is_cached,
                cache_size, cast(current_value as varchar(50)) as current_value,
                cast(last_used_value as varchar(50)) as last_used_value, is_exhausted
              from sys.sequences order by s, name`
}

const SEQUENCES = ['sales.order_numbers', 'dbo.countdown', 'dbo.levels', 'dbo.later']

function sqlServerTarget() {
  const target = serverConnectionFromUrl('sqlserver', url!)
  if (target.connection.driver !== 'sqlserver') {
    throw new Error('no SQL Server target')
  }
  return { connection: target.connection, password: target.password }
}

/** Every catalog fact and every row as JSON text, for comparing two databases. */
async function snapshot(database: string): Promise<Record<string, unknown>> {
  const { connection, password } = sqlServerTarget()
  const client = await connectSqlServer({ ...connection, database }, password, () => undefined)
  try {
    const result: Record<string, unknown> = {}
    for (const [name, sql] of Object.entries(CATALOG_QUERIES)) {
      result[name] = await querySqlServerRows(client, sql)
    }
    for (const table of ['dbo.people', 'sales.orders', 'dbo.a', 'dbo.b', 'dbo.people_view']) {
      const [row] = await querySqlServerRows(
        client,
        `select (select * from ${table} order by 1 for json path, include_null_values) as rows`
      )
      const rows: unknown = JSON.parse(String(row?.rows ?? '[]'))
      // rowversion values are the server's own counter, never the same in two databases.
      result[table] = Array.isArray(rows)
        ? rows.map((value: Record<string, unknown>) => ({ ...value, version: null }))
        : rows
    }
    return result
  } finally {
    await closeSqlServer(client)
  }
}

/** The next two values of each sequence, or the error that stops it, taking them. */
async function nextValues(database: string): Promise<Record<string, string[]>> {
  const { connection, password } = sqlServerTarget()
  const client = await connectSqlServer({ ...connection, database }, password, () => undefined)
  try {
    const result: Record<string, string[]> = {}
    for (const name of SEQUENCES) {
      const values: string[] = []
      for (let taken = 0; taken < 2; taken += 1) {
        const sql = `select cast(next value for ${name} as varchar(50)) as value`
        values.push(
          await querySqlServerRows(client, sql).then(
            ([row]) => String(row?.value),
            (error: unknown) => (error instanceof Error ? error.message : String(error))
          )
        )
      }
      result[name] = values
    }
    return result
  } finally {
    await closeSqlServer(client)
  }
}

/** Runs a script's GO batches in order on one session, as sqlcmd or SSMS would. */
async function runScript(database: string, files: readonly string[]): Promise<void> {
  const { connection, password } = sqlServerTarget()
  const client = await connectSqlServer({ ...connection, database }, password, () => undefined)
  try {
    for (const file of files) {
      for (const batch of splitSqlBatches(readFileSync(file, 'utf8'), 'sqlserver')) {
        await new Promise<void>((resolve, reject) => {
          const request = new Request(batch.text, (error) =>
            error ? reject(new Error(`${error.message}\n--- in batch:\n${batch.text}`)) : resolve()
          )
          client.execSqlBatch(request)
        })
      }
    }
  } finally {
    await closeSqlServer(client)
  }
}

describe.skipIf(!url)('SQL Server dump', () => {
  const created: string[] = [source]

  const dump = async (
    options: Partial<DatabaseDumpOptions>,
    path: string,
    objects: DatabaseDumpObject[] = OBJECTS
  ) => {
    const { connection, password } = sqlServerTarget()
    const client = await connectSqlServer(
      { ...connection, database: source },
      password,
      () => undefined
    )
    const dumpSource = new SqlServerDumpSource(client)
    try {
      return await runDump({
        source: dumpSource,
        request: { objects, options: { ...OPTIONS, ...options } },
        output: new DumpOutput(
          options.layout === 'file-per-table' ? { kind: 'folder', path } : { kind: 'file', path },
          'sqlserver'
        ),
        onProgress: () => undefined,
        isCancelled: () => false
      })
    } finally {
      await dumpSource.close()
    }
  }

  const newDatabase = async (): Promise<string> => {
    const database = `orca_dump_target_${randomUUID().slice(0, 8)}`
    created.push(database)
    await runAdminSql(sqlServerTarget(), [`create database ${database}`])
    return database
  }

  beforeAll(async () => {
    await runAdminSql(sqlServerTarget(), [
      `create database ${source}`,
      `alter database ${source} set allow_snapshot_isolation on`
    ])
    await runAdminSql(sqlServerTarget(), FIXTURE, { database: source })
  })

  afterAll(async () => {
    await runAdminSql(
      sqlServerTarget(),
      created.flatMap((database) => [
        `alter database ${database} set single_user with rollback immediate`,
        `drop database ${database}`
      ]),
      { ignoreErrors: true }
    )
  })

  it('restores the same tables, rows, identities, keys, views, routines and triggers', async () => {
    const summary = await dump({}, join(dir, 'all.sql'))
    expect(summary).toMatchObject({ cancelled: false, tables: 4, rows: 9 })
    expect(summary.notes).toEqual([])
    const database = await newDatabase()
    await runScript(database, summary.files)
    expect(await snapshot(database)).toEqual(await snapshot(source))
  })

  it('creates each sequence before its tables, once, handing out the same values after', async () => {
    const summary = await dump({}, join(dir, 'sequences.sql'))
    const script = readFileSync(summary.files[0]!, 'utf8')
    // Two tables draw from sales.order_numbers; it is created and moved on once.
    expect(script.match(/CREATE SEQUENCE sales\.order_numbers /g)).toHaveLength(1)
    expect(script.match(/@sequence_name = N'sales\.order_numbers'/g)).toHaveLength(1)
    expect(script.indexOf('CREATE SEQUENCE sales.order_numbers')).toBeLessThan(
      script.indexOf('CREATE TABLE sales.orders')
    )
    const database = await newDatabase()
    await runScript(database, summary.files)
    const exhausted = /reached its minimum or maximum value/
    const expected = await nextValues(source)
    expect(expected).toEqual({
      'sales.order_numbers': ['1050', '1060'],
      'dbo.countdown': ['-4', '-6'],
      'dbo.levels': [expect.stringMatching(exhausted), expect.stringMatching(exhausted)],
      'dbo.later': ['7', '8']
    })
    expect(await nextValues(database)).toEqual(expected)
  })

  it('restores from a file per table twice over, dropping what the first load made', async () => {
    const summary = await dump(
      { layout: 'file-per-table', disableForeignKeys: false, dropExisting: true },
      join(dir, 'per-table')
    )
    // a and b reference each other, so their keys still wait for the finish file.
    expect(summary.notes.join(' ')).toMatch(/cycle/)
    const database = await newDatabase()
    await runScript(database, summary.files)
    await runScript(database, summary.files)
    expect(await snapshot(database)).toEqual(await snapshot(source))
  })

  it('replaces a sequence the target defines otherwise, or stops when it can’t', async () => {
    const replacing = await dump({ dropExisting: true }, join(dir, 'replacing.sql'))
    const keeping = await dump({}, join(dir, 'keeping.sql'))
    // Another step, range, cycling and cache than the source's sales.order_numbers.
    const differing = [
      'create schema sales',
      `create sequence sales.order_numbers as bigint
         start with 1 increment by 1 minvalue 1 maxvalue 999999 cycle cache 5`
    ]
    /** sales.order_numbers's step and cycling in `database`. */
    const orderNumbers = async (database: string) => {
      const { connection, password } = sqlServerTarget()
      const client = await connectSqlServer({ ...connection, database }, password, () => undefined)
      try {
        return await querySqlServerRows(
          client,
          `select cast(increment as varchar(20)) as increment, is_cycling
           from sys.sequences where object_id = object_id(N'sales.order_numbers')`
        )
      } finally {
        await closeSqlServer(client)
      }
    }
    const asTheTargetHadIt = [{ increment: '1', is_cycling: true }]

    const replaced = await newDatabase()
    await runAdminSql(sqlServerTarget(), differing, { database: replaced })
    await runScript(replaced, replacing.files)
    expect(await snapshot(replaced)).toEqual(await snapshot(source))

    const shared = await newDatabase()
    await runAdminSql(
      sqlServerTarget(),
      [
        ...differing,
        'create table dbo.elsewhere (n bigint default (next value for sales.order_numbers))'
      ],
      { database: shared }
    )
    await expect(runScript(shared, replacing.files)).rejects.toThrow(
      /Sequence sales\.order_numbers already exists with a definition other than the dumped one, and other objects use it/
    )
    expect(await orderNumbers(shared)).toEqual(asTheTargetHadIt)

    const kept = await newDatabase()
    await runAdminSql(sqlServerTarget(), differing, { database: kept })
    await expect(runScript(kept, keeping.files)).rejects.toThrow(
      /Sequence sales\.order_numbers already exists with a definition other than the dumped one\. Drop it/
    )
    expect(await orderNumbers(kept)).toEqual(asTheTargetHadIt)
  })

  it('exports only rows, loading into the same structure with its keys switched off', async () => {
    const structure = await dump({ contents: 'structure' }, join(dir, 'structure.sql'))
    const data = await dump({ contents: 'data' }, join(dir, 'data.sql'))
    expect(readFileSync(data.files[0]!, 'utf8')).not.toMatch(/CREATE TABLE/)
    expect(data.notes.join(' ')).toMatch(/not trusted/)
    const database = await newDatabase()
    await runScript(database, [...structure.files, ...data.files])
    expect(await snapshot(database)).toEqual(await snapshot(source))
  })

  it('stops a read mid-table and leaves the session free for the next request', async () => {
    await runAdminSql(
      sqlServerTarget(),
      [
        `select top (20000) row_number() over (order by (select null)) as id, cast(N'x' as nvarchar(10)) as v
         into dbo.many from sys.all_objects a cross join sys.all_objects b`
      ],
      { database: source }
    )
    const { connection, password } = sqlServerTarget()
    const client = await connectSqlServer(
      { ...connection, database: source },
      password,
      () => undefined
    )
    let cancelled = false
    // Stops after the first batch, while the server still has most of the table to send.
    class StoppingSource extends SqlServerDumpSource {
      override async *rows(table: Parameters<SqlServerDumpSource['rows']>[0], batchSize: number) {
        for await (const batch of super.rows(table, batchSize)) {
          cancelled = true
          yield batch
        }
      }
    }
    const path = join(dir, 'cancelled.sql')
    try {
      const summary = await runDump({
        source: new StoppingSource(client),
        request: {
          objects: [{ kind: 'table', schema: 'dbo', name: 'many' }],
          options: { ...OPTIONS, rowsPerInsert: 10 }
        },
        output: new DumpOutput({ kind: 'file', path }, 'sqlserver'),
        onProgress: () => undefined,
        isCancelled: () => cancelled
      })
      expect(summary).toMatchObject({ cancelled: true, files: [] })
      expect(await querySqlServerRows(client, 'select count(*) as n from dbo.many')).toEqual([
        { n: 20000 }
      ])
    } finally {
      await closeSqlServer(client)
      await runAdminSql(sqlServerTarget(), ['drop table dbo.many'], { database: source })
    }
  })

  it('ends a read its reader left early, so the session takes the next request', async () => {
    const { connection, password } = sqlServerTarget()
    const client = await connectSqlServer(connection, password, () => undefined)
    try {
      const stream = streamSqlServerRows(
        client,
        'select top (20000) a.object_id from sys.all_objects a cross join sys.all_objects b',
        10,
        () => undefined
      )
      for await (const batch of stream) {
        expect(batch).toHaveLength(10)
        break
      }
      expect(await querySqlServerRows(client, 'select 1 as one')).toEqual([{ one: 1 }])
    } finally {
      await closeSqlServer(client)
    }
  })
})
