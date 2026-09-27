import type { DatabaseSync } from 'node:sqlite'
import { quoteSqlName } from '../../../../shared/database/sql-identifiers'
import type {
  DumpSource,
  DumpTableInfo,
  DumpTableStructure,
  DumpViewDefinition
} from './dump-source'

const q = (name: string): string => quoteSqlName(name, 'sqlite')

export function sqliteTextLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'number') {
    // Why 9e999: SQLite reads it as infinity, which `Infinity` isn't in SQL.
    return Number.isFinite(value) ? String(value) : value > 0 ? '9e999' : '-9e999'
  }
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString('hex')}'`
  }
  return sqliteTextLiteral(String(value))
}

/** SQLite's reads for a dump: the objects' own CREATE text, rows in one read transaction. */
export class SqliteDumpSource implements DumpSource {
  readonly dialect = 'sqlite' as const
  readonly notes: string[] = []
  private readonly selects = new Map<string, string>()

  constructor(private readonly database: DatabaseSync) {}

  async begin(): Promise<void> {
    this.database.exec('BEGIN')
  }

  async end(): Promise<void> {
    if (this.database.isTransaction) {
      this.database.exec('COMMIT')
    }
  }

  async close(): Promise<void> {
    this.database.close()
  }

  settings(options: { foreignKeyChecksOff: boolean }) {
    return options.foreignKeyChecksOff
      ? {
          before: [{ sql: 'PRAGMA foreign_keys = OFF' }],
          after: [{ sql: 'PRAGMA foreign_keys = ON' }]
        }
      : { before: [], after: [] }
  }

  createSchema() {
    return []
  }

  enterSchema() {
    return []
  }

  async tableInfo(table: { schema: string; name: string }): Promise<DumpTableInfo> {
    const columns = this.database
      .prepare(`pragma ${q(table.schema)}.table_xinfo(${sqliteTextLiteral(table.name)})`)
      .all()
    const references = this.database
      .prepare(`pragma ${q(table.schema)}.foreign_key_list(${sqliteTextLiteral(table.name)})`)
      .all()
    // hidden 2 and 3 are generated columns; 1 is a virtual table's hidden column.
    const insertable = columns.filter((column) => Number(column.hidden) === 0)
    const sqlName = q(table.name)
    this.selects.set(
      sqlName,
      `select ${insertable.map((column) => q(String(column.name))).join(', ')} from ${q(table.schema)}.${sqlName}`
    )
    return {
      ...table,
      sqlName,
      columns: insertable.map((column) => q(String(column.name))),
      explicitIdentity: false,
      references: [...new Set(references.map((row) => String(row.table)))].map((name) => ({
        schema: table.schema,
        name
      }))
    }
  }

  async tableStructure(table: DumpTableInfo): Promise<DumpTableStructure> {
    const objects = this.database
      .prepare(
        `select type, sql from ${q(table.schema)}.sqlite_master
         where tbl_name = ? and sql is not null
         order by case type when 'table' then 0 when 'index' then 1 else 2 end, name`
      )
      .all(table.name)
    const of = (type: string) =>
      objects.filter((row) => row.type === type).map((row) => ({ sql: String(row.sql) }))
    return {
      requires: [],
      create: [...of('table'), ...of('index')],
      foreignKeys: [],
      triggers: of('trigger')
    }
  }

  async *rows(table: DumpTableInfo, batchSize: number): AsyncIterable<string[][]> {
    const select = this.selects.get(table.sqlName)
    if (!select || table.columns.length === 0) {
      return
    }
    const statement = this.database.prepare(select)
    statement.setReturnArrays(true)
    // Why bigints: integers past 2^53 would otherwise round on their way through a JS number.
    statement.setReadBigInts(true)
    let batch: string[][] = []
    for (const row of statement.iterate()) {
      const values: unknown = row
      batch.push(Array.isArray(values) ? values.map(sqliteLiteral) : [])
      if (batch.length >= batchSize) {
        yield batch
        batch = []
      }
    }
    if (batch.length > 0) {
      yield batch
    }
  }

  beforeRows() {
    return []
  }

  // Why sqlite_sequence: an AUTOINCREMENT table must not hand out numbers it already used.
  async afterRows(table: DumpTableInfo) {
    const hasSequences = this.database
      .prepare(`select 1 from ${q(table.schema)}.sqlite_master where name = 'sqlite_sequence'`)
      .get()
    const row = hasSequences
      ? this.database
          .prepare(`select seq from ${q(table.schema)}.sqlite_sequence where name = ?`)
          .get(table.name)
      : undefined
    if (!row) {
      return []
    }
    const name = sqliteTextLiteral(table.name)
    return [
      { sql: `DELETE FROM sqlite_sequence WHERE name = ${name}` },
      { sql: `INSERT INTO sqlite_sequence (name, seq) VALUES (${name}, ${String(row.seq)})` }
    ]
  }

  async view(view: { schema: string; name: string }): Promise<DumpViewDefinition> {
    const row = this.database
      .prepare(`select sql from ${q(view.schema)}.sqlite_master where type = 'view' and name = ?`)
      .get(view.name)
    if (!row) {
      throw new Error(`${view.name} no longer exists.`)
    }
    const definition = String(row.sql)
    return {
      definition,
      create: [{ sql: definition }],
      drop: { sql: `DROP VIEW IF EXISTS ${q(view.name)}` }
    }
  }

  async routine(): Promise<never> {
    throw new Error('SQLite has no stored routines.')
  }

  dropTables(tables: readonly DumpTableInfo[]) {
    return tables.map((table) => ({ sql: `DROP TABLE IF EXISTS ${table.sqlName}` }))
  }

  // Why nothing: SQLite reads synchronously here; the runner stops between batches.
  cancel(): void {}
}
