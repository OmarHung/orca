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
import {
  commentForNoBackslashEscapes,
  createColumn,
  creationContext,
  inCreationContext,
  withoutDefiner
} from './mysql-show-create'
import {
  mysqlValueKind,
  mysqlValueLiteral,
  mysqlValueSelect,
  type MysqlValueKind
} from './mysql-dump-values'

const q = (name: string): string => quoteSqlName(name, 'mysql')

/** MySQL/MariaDB reads for a dump, in one consistent snapshot, times read and written in UTC. */
export class MysqlDumpSource implements DumpSource {
  readonly dialect = 'mysql' as const
  readonly notes: string[] = []
  private readonly kinds = new Map<string, MysqlValueKind[]>()
  private readonly selects = new Map<string, string>()
  private readonly collations = new Map<string, string | null>()
  private current: string | null = null
  private stream: Readable | null = null

  constructor(private readonly client: mysql.Connection) {}

  async begin(): Promise<void> {
    // Why no sql_mode: SHOW CREATE TABLE and VIEW then write the plain SQL the dump's settings
    // read, whatever the server's mode; triggers and routines carry their own.
    await queryMysqlRows(this.client, "SET SESSION sql_mode = '', time_zone = '+00:00'")
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
        {
          sql: 'SET @ORCA_OLD_CHARACTER_SET_CLIENT = @@CHARACTER_SET_CLIENT, @ORCA_OLD_CHARACTER_SET_RESULTS = @@CHARACTER_SET_RESULTS, @ORCA_OLD_COLLATION_CONNECTION = @@COLLATION_CONNECTION'
        },
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
        { sql: 'SET TIME_ZONE = @ORCA_OLD_TIME_ZONE' },
        {
          sql: 'SET CHARACTER_SET_CLIENT = @ORCA_OLD_CHARACTER_SET_CLIENT, CHARACTER_SET_RESULTS = @ORCA_OLD_CHARACTER_SET_RESULTS, COLLATION_CONNECTION = @ORCA_OLD_COLLATION_CONNECTION'
        }
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
    const kinds = insertable.map((column) => mysqlValueKind(String(column.type)))
    const qualified = `${q(table.schema)}.${q(table.name)}`
    const expressions = insertable.map((column, index) =>
      mysqlValueSelect(q(String(column.name)), String(column.type), kinds[index] ?? 'text')
    )
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
      const name = String(trigger.name)
      const [row] = await queryMysqlRows(this.client, `SHOW CREATE TRIGGER ${q(name)}`)
      const create = {
        sql: withoutDefiner(createColumn(row, 'SQL Original Statement')),
        compound: true
      }
      triggerStatements.push(
        ...(await this.inCreationContext(`Trigger ${name}`, table.schema, create, row))
      )
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
    for await (const row of stream) {
      const values: unknown = row
      if (!Array.isArray(values)) {
        continue
      }
      batch.push(values.map((value: unknown, index) => mysqlValueLiteral(kinds[index], value)))
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
      create: await this.inCreationContext(
        `View ${view.name}`,
        view.schema,
        { sql: definition },
        row
      ),
      drop: { sql: `DROP VIEW IF EXISTS ${q(view.name)}` }
    }
  }

  async routine(routine: { schema: string; name: string; routineKind: 'function' | 'procedure' }) {
    await this.use(routine.schema)
    const kind = routine.routineKind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
    const [row] = await queryMysqlRows(this.client, `SHOW CREATE ${kind} ${q(routine.name)}`)
    const noun = kind === 'PROCEDURE' ? 'Procedure' : 'Function'
    const label = `${noun} ${routine.name}`
    const sql = withoutDefiner(createColumn(row, `Create ${noun}`))
    return {
      create: await this.inCreationContext(
        label,
        routine.schema,
        { sql: await this.withLoadableComment(routine, kind, sql, row), compound: true },
        row
      ),
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

  private async inCreationContext(
    label: string,
    schema: string,
    create: DumpStatement,
    row: Record<string, unknown> | undefined
  ): Promise<DumpStatement[]> {
    if (!this.collations.has(schema)) {
      const [database] = await queryMysqlRows(
        this.client,
        'select DEFAULT_COLLATION_NAME as collation from information_schema.SCHEMATA where SCHEMA_NAME = ?',
        [schema]
      )
      this.collations.set(
        schema,
        typeof database?.collation === 'string' ? database.collation : null
      )
    }
    const collation = this.collations.get(schema) ?? null
    return inCreationContext(label, create, creationContext(row), collation, this.notes)
  }

  // A comment SHOW CREATE escaped for a routine that reads it under NO_BACKSLASH_ESCAPES.
  private async withLoadableComment(
    routine: { schema: string; name: string },
    kind: 'PROCEDURE' | 'FUNCTION',
    sql: string,
    row: Record<string, unknown> | undefined
  ): Promise<string> {
    if (!/NO_BACKSLASH_ESCAPES/.test(String(row?.sql_mode ?? ''))) {
      return sql
    }
    const [comment] = await queryMysqlRows(
      this.client,
      `select ROUTINE_COMMENT as comment from information_schema.ROUTINES
       where ROUTINE_SCHEMA = ? and ROUTINE_NAME = ? and ROUTINE_TYPE = ?`,
      [routine.schema, routine.name, kind]
    )
    const loadable = commentForNoBackslashEscapes(sql, String(comment?.comment ?? ''))
    if (loadable === null) {
      this.notes.push(
        `The comment of ${routine.name} may load with its backslashes doubled: SHOW CREATE escapes it, and the routine loads under NO_BACKSLASH_ESCAPES.`
      )
    }
    return loadable ?? sql
  }

  // Why USE before SHOW CREATE: names in the current database come back unqualified.
  private async use(schema: string): Promise<void> {
    if (this.current !== schema) {
      await queryMysqlRows(this.client, `USE ${q(schema)}`)
      this.current = schema
    }
  }
}
