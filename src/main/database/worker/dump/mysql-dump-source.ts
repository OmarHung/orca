import type mysql from 'mysql2'
import type { Readable } from 'node:stream'
import { quoteSqlName } from '../../../../shared/database/sql-identifiers'
import { queryMysqlRows } from '../mysql-client-factory'
import type { DumpStatement } from './dump-output'
import type {
  DumpSource,
  DumpTableInfo,
  DumpTableStructure,
  DumpViewDefinition
} from './dump-source'

const q = (name: string): string => quoteSqlName(name, 'mysql')

const BINARY_TYPES = new Set([
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  'geometrycollection'
])
const NUMERIC_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'bit'
])

type ColumnKind = 'text' | 'number' | 'hex'

// Why strip DEFINER: loading as another account would otherwise need SUPER to keep it.
function withoutDefiner(sql: string): string {
  return sql.replace(/\sDEFINER\s*=\s*(`[^`]*`|'[^']*'|\S+)@(`[^`]*`|'[^']*'|\S+)/i, '')
}

export function mysqlTextLiteral(value: string): string {
  // Why backslashes too: MySQL's default sql_mode reads them as escapes inside strings.
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function createColumn(row: Record<string, unknown> | undefined, prefix: string): string {
  const entry = Object.entries(row ?? {}).find(([key]) => key.startsWith(prefix))
  if (typeof entry?.[1] !== 'string') {
    throw new Error(
      'The server didn’t return a definition; the user may lack the privilege to see it.'
    )
  }
  return entry[1]
}

/** MySQL/MariaDB reads for a dump, in one consistent snapshot, times read and written in UTC. */
export class MysqlDumpSource implements DumpSource {
  readonly dialect = 'mysql' as const
  readonly notes: string[] = []
  private readonly kinds = new Map<string, ColumnKind[]>()
  private readonly selects = new Map<string, string>()
  private current: string | null = null
  private stream: Readable | null = null

  constructor(private readonly client: mysql.Connection) {}

  async begin(): Promise<void> {
    await queryMysqlRows(this.client, "SET time_zone = '+00:00'")
    await queryMysqlRows(this.client, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await queryMysqlRows(this.client, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
  }

  async end(): Promise<void> {
    await queryMysqlRows(this.client, 'COMMIT')
  }

  async close(): Promise<void> {
    // Why destroy after a stopped read: end() would wait for the rest of its rows first.
    if (this.stream) {
      this.client.destroy()
      return
    }
    await new Promise<void>((resolve) => this.client.end(() => resolve()))
  }

  settings(options: { foreignKeyChecksOff: boolean }) {
    return {
      before: [
        { sql: 'SET NAMES utf8mb4' },
        { sql: "SET @ORCA_OLD_TIME_ZONE = @@TIME_ZONE, TIME_ZONE = '+00:00'" },
        // Why: a 0 in an AUTO_INCREMENT column must stay 0, not become the next value.
        { sql: "SET @ORCA_OLD_SQL_MODE = @@SQL_MODE, SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO'" },
        ...(options.foreignKeyChecksOff
          ? [
              {
                sql: 'SET @ORCA_OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0'
              }
            ]
          : [])
      ],
      after: [
        ...(options.foreignKeyChecksOff
          ? [{ sql: 'SET FOREIGN_KEY_CHECKS = @ORCA_OLD_FOREIGN_KEY_CHECKS' }]
          : []),
        { sql: 'SET SQL_MODE = @ORCA_OLD_SQL_MODE' },
        { sql: 'SET TIME_ZONE = @ORCA_OLD_TIME_ZONE' }
      ]
    }
  }

  // One database loads into whichever the script runs in; several name their own.
  createSchema(schema: string, schemaCount: number) {
    return schemaCount > 1 ? [{ sql: `CREATE DATABASE IF NOT EXISTS ${q(schema)}` }] : []
  }

  enterSchema(schema: string, schemaCount: number) {
    return schemaCount > 1 ? [{ sql: `USE ${q(schema)}` }] : []
  }

  async tableInfo(table: { schema: string; name: string }): Promise<DumpTableInfo> {
    const columns = await queryMysqlRows(
      this.client,
      `select COLUMN_NAME as name, DATA_TYPE as type, EXTRA as extra
       from information_schema.COLUMNS where TABLE_SCHEMA = ? and TABLE_NAME = ?
       order by ORDINAL_POSITION`,
      [table.schema, table.name]
    )
    const references = await queryMysqlRows(
      this.client,
      `select distinct REFERENCED_TABLE_SCHEMA as \`schema\`, REFERENCED_TABLE_NAME as name
       from information_schema.KEY_COLUMN_USAGE
       where TABLE_SCHEMA = ? and TABLE_NAME = ? and REFERENCED_TABLE_NAME is not null`,
      [table.schema, table.name]
    )
    const insertable = columns.filter((column) => !/GENERATED/i.test(String(column.extra ?? '')))
    const kinds = insertable.map((column): ColumnKind => {
      const type = String(column.type).toLowerCase()
      return BINARY_TYPES.has(type) ? 'hex' : NUMERIC_TYPES.has(type) ? 'number' : 'text'
    })
    const qualified = `${q(table.schema)}.${q(table.name)}`
    const expressions = insertable.map((column, index) => {
      const name = q(String(column.name))
      const type = String(column.type).toLowerCase()
      return kinds[index] === 'hex' ? `HEX(${name})` : type === 'bit' ? `${name} + 0` : name
    })
    this.kinds.set(qualified, kinds)
    this.selects.set(qualified, `SELECT ${expressions.join(', ')} FROM ${qualified}`)
    return {
      ...table,
      // Unqualified: the script's current database (one, or the one it USEd) holds it.
      sqlName: q(table.name),
      columns: insertable.map((column) => q(String(column.name))),
      explicitIdentity: false,
      references: references.map((row) => ({ schema: String(row.schema), name: String(row.name) }))
    }
  }

  async tableStructure(table: DumpTableInfo): Promise<DumpTableStructure> {
    await this.use(table.schema)
    const [create] = await queryMysqlRows(this.client, `SHOW CREATE TABLE ${q(table.name)}`)
    const triggers = await queryMysqlRows(
      this.client,
      `select TRIGGER_NAME as name from information_schema.TRIGGERS
       where EVENT_OBJECT_SCHEMA = ? and EVENT_OBJECT_TABLE = ? order by ACTION_ORDER, TRIGGER_NAME`,
      [table.schema, table.name]
    )
    const triggerStatements: DumpStatement[] = []
    for (const trigger of triggers) {
      const [row] = await queryMysqlRows(
        this.client,
        `SHOW CREATE TRIGGER ${q(String(trigger.name))}`
      )
      triggerStatements.push({
        sql: withoutDefiner(createColumn(row, 'SQL Original Statement')),
        compound: true
      })
    }
    return {
      requires: [],
      create: [{ sql: createColumn(create, 'Create Table') }],
      // Foreign keys stay inline: with checks off MySQL takes them in any order.
      foreignKeys: [],
      triggers: triggerStatements
    }
  }

  async *rows(table: DumpTableInfo, batchSize: number): AsyncIterable<string[][]> {
    const qualified = `${q(table.schema)}.${q(table.name)}`
    const kinds = this.kinds.get(qualified) ?? []
    if (kinds.length === 0) {
      return
    }
    const query = this.client.query({
      sql: this.selects.get(qualified)!,
      rowsAsArray: true,
      // Why text for everything: no value passes through a JS number on its way out.
      typeCast: (field: { string: () => string | null }) => field.string()
    })
    const stream = query.stream({ highWaterMark: batchSize })
    this.stream = stream
    let batch: string[][] = []
    for await (const row of stream as AsyncIterable<(string | null)[]>) {
      batch.push(
        row.map((value, index) => {
          if (value === null) {
            return 'NULL'
          }
          const kind = kinds[index]
          return kind === 'hex'
            ? `X'${value}'`
            : kind === 'number'
              ? value
              : mysqlTextLiteral(value)
        })
      )
      if (batch.length >= batchSize) {
        yield batch
        batch = []
      }
    }
    this.stream = null
    if (batch.length > 0) {
      yield batch
    }
  }

  beforeRows() {
    return []
  }

  async afterRows() {
    return []
  }

  async view(view: { schema: string; name: string }): Promise<DumpViewDefinition> {
    await this.use(view.schema)
    const [row] = await queryMysqlRows(this.client, `SHOW CREATE VIEW ${q(view.name)}`)
    const definition = withoutDefiner(createColumn(row, 'Create View'))
    return {
      definition,
      create: [{ sql: definition }],
      drop: { sql: `DROP VIEW IF EXISTS ${q(view.name)}` }
    }
  }

  async routine(routine: { schema: string; name: string; routineKind: 'function' | 'procedure' }) {
    await this.use(routine.schema)
    const kind = routine.routineKind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
    const [row] = await queryMysqlRows(this.client, `SHOW CREATE ${kind} ${q(routine.name)}`)
    return {
      create: {
        sql: withoutDefiner(
          createColumn(row, `Create ${kind === 'PROCEDURE' ? 'Procedure' : 'Function'}`)
        ),
        compound: true
      },
      drop: { sql: `DROP ${kind} IF EXISTS ${q(routine.name)}` }
    }
  }

  dropTables(tables: readonly DumpTableInfo[]) {
    return tables.length === 0
      ? []
      : [{ sql: `DROP TABLE IF EXISTS ${tables.map((table) => table.sqlName).join(', ')}` }]
  }

  cancel(): void {
    this.stream?.destroy()
  }

  // Why USE before SHOW CREATE: names in the current database come back unqualified.
  private async use(schema: string): Promise<void> {
    if (this.current !== schema) {
      await queryMysqlRows(this.client, `USE ${q(schema)}`)
      this.current = schema
    }
  }
}
