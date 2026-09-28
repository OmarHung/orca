import { ISOLATION_LEVEL, type Connection, type Request } from 'tedious'
import type { DatabaseDumpObject } from '../../../../shared/database/database-dump-types'
import { quoteSqlName } from '../../../../shared/database/sql-identifiers'
import { catalogText, type CatalogRow } from '../catalog-row-grouping'
import { closeSqlServer, querySqlServerRows } from '../sqlserver-client-factory'
import { SQL_SERVER_OBJECT_ID, sqlServerTableDdl } from '../sqlserver-ddl'
import type { DumpStatement } from './dump-output'
import {
  ALIAS_TYPES_SQL,
  aliasTypeStatement,
  COLUMNS_SQL,
  FOREIGN_KEYS_SQL,
  IDENTITY_SQL,
  parametersOf,
  sqlServerDropTables,
  TRIGGERS_SQL
} from './sqlserver-dump-catalog'
import type {
  DumpSource,
  DumpStructureOptions,
  DumpTableInfo,
  DumpTableStructure,
  DumpViewDefinition
} from './dump-source'
import { SqlServerDumpSequences } from './sqlserver-dump-sequences'
import {
  sqlServerTextLiteral,
  sqlServerValueKind,
  sqlServerValueLiteral,
  sqlServerValueSelect,
  type SqlServerValueKind
} from './sqlserver-dump-values'
import { streamSqlServerRows } from './sqlserver-row-stream'

const q = (name: string): string => quoteSqlName(name, 'sqlserver')

type TablePlan = { select: string; kinds: SqlServerValueKind[]; foreignKeys: string[] }

/** SQL Server's reads for a dump, in one SNAPSHOT transaction when the database allows it. */
export class SqlServerDumpSource implements DumpSource {
  readonly dialect = 'sqlserver' as const
  readonly notes: string[] = []
  private readonly plans = new Map<string, TablePlan>()
  private readonly rowCounts = new Map<string, number>()
  private readonly sequences: SqlServerDumpSequences
  private request: Request | null = null
  private inTransaction = false
  private checksOffWhileLoading = false

  constructor(private readonly client: Connection) {
    this.sequences = new SqlServerDumpSequences(client)
  }

  async begin(): Promise<void> {
    const [database] = await querySqlServerRows(
      this.client,
      'select snapshot_isolation_state as state from sys.databases where database_id = db_id()'
    )
    if (Number(database?.state) !== 1) {
      this.notes.push(
        'Snapshot isolation is off for this database, so each table was read at its own moment; rows changed during the export may not line up across tables.'
      )
      return
    }
    await new Promise<void>((resolve, reject) =>
      this.client.beginTransaction(
        (error) => (error ? reject(error) : resolve()),
        '',
        ISOLATION_LEVEL.SNAPSHOT
      )
    )
    this.inTransaction = true
  }

  async end(): Promise<void> {
    if (this.inTransaction) {
      await new Promise<void>((resolve, reject) =>
        this.client.commitTransaction((error) => (error ? reject(error) : resolve()))
      )
      this.inTransaction = false
    }
  }

  async close(): Promise<void> {
    await closeSqlServer(this.client)
  }

  settings(options: { foreignKeyChecksOff: boolean; dataOnly: boolean }) {
    // SQL Server has no session switch for foreign keys; a structure dump adds them after the
    // rows, and a data dump turns each table's own keys off while its rows load.
    this.checksOffWhileLoading = options.foreignKeyChecksOff && options.dataOnly
    if (this.checksOffWhileLoading && !this.notes.some((note) => note.includes('not trusted'))) {
      this.notes.push(
        'Each table’s foreign keys are switched off while its rows load and back on after, without rechecking those rows; SQL Server marks them not trusted until ALTER TABLE … WITH CHECK CHECK CONSTRAINT ALL.'
      )
    }
    return {
      before: [{ sql: 'SET ANSI_NULLS ON' }, { sql: 'SET QUOTED_IDENTIFIER ON' }],
      after: []
    }
  }

  // Why EXEC: CREATE SCHEMA must start its batch, so it can't follow IF directly.
  createSchema(schema: string): DumpStatement[] {
    return schema === 'dbo'
      ? []
      : [
          {
            sql: `IF SCHEMA_ID(${sqlServerTextLiteral(schema)}) IS NULL EXEC(${sqlServerTextLiteral(`CREATE SCHEMA ${q(schema)}`)})`
          }
        ]
  }

  enterSchema(): DumpStatement[] {
    return []
  }

  async tableInfo(table: { schema: string; name: string }): Promise<DumpTableInfo> {
    const parameters = parametersOf(table)
    const columns = await querySqlServerRows(this.client, COLUMNS_SQL, parameters)
    if (columns.length === 0) {
      throw new Error(`${table.schema}.${table.name} no longer exists.`)
    }
    const foreignKeys = await querySqlServerRows(this.client, FOREIGN_KEYS_SQL, parameters)
    // Computed and rowversion columns take no values of their own.
    const insertable = columns.filter(
      (column) => column.is_computed !== true && catalogText(column.base_type) !== 'timestamp'
    )
    const baseTypes = insertable.map((column) => catalogText(column.base_type))
    const kinds = insertable.map((column, index) =>
      sqlServerValueKind(baseTypes[index] ?? '', column.is_assembly_type === true)
    )
    if (baseTypes.includes('sql_variant')) {
      this.notes.push(
        `${table.schema}.${table.name} has sql_variant columns; their values are exported as text, so each loads as a string rather than its original type.`
      )
    }
    const sqlName = `${q(table.schema)}.${q(table.name)}`
    const expressions = insertable.map((column, index) =>
      sqlServerValueSelect(catalogText(column.name), baseTypes[index] ?? '', kinds[index] ?? 'text')
    )
    this.plans.set(sqlName, {
      select: `SELECT ${expressions.join(', ')} FROM ${sqlName}`,
      kinds,
      foreignKeys: foreignKeys.map((row) => catalogText(row.name))
    })
    const referenced = new Map(
      foreignKeys.map((row) => {
        const target = { schema: catalogText(row.ref_schema), name: catalogText(row.ref_name) }
        return [JSON.stringify(target), target]
      })
    )
    return {
      ...table,
      sqlName,
      columns: insertable.map((column) => q(catalogText(column.name))),
      explicitIdentity: insertable.some((column) => column.is_identity === true),
      references: [...referenced.values()]
    }
  }

  async tableStructure(
    table: DumpTableInfo,
    { separateForeignKeys, dropExisting }: DumpStructureOptions
  ): Promise<DumpTableStructure> {
    const parameters = parametersOf(table)
    const ddl = await sqlServerTableDdl(this.client, table.schema, table.name, {
      separateForeignKeys
    })
    const aliasTypes = await querySqlServerRows(this.client, ALIAS_TYPES_SQL, parameters)
    const sequences = await this.sequences.creates(table, dropExisting)
    const triggers = await querySqlServerRows(this.client, TRIGGERS_SQL, parameters)
    return {
      requires: [...aliasTypes.map(aliasTypeStatement), ...sequences],
      create: [ddl.create, ...ddl.indexes].map((sql) => ({ sql })),
      foreignKeys: ddl.foreignKeys.map((sql) => ({ sql })),
      triggers: triggers.flatMap((trigger) => this.triggerStatements(table, trigger))
    }
  }

  async *rows(table: DumpTableInfo, batchSize: number): AsyncIterable<string[][]> {
    const plan = this.plans.get(table.sqlName)
    if (!plan || plan.kinds.length === 0) {
      return
    }
    const stream = streamSqlServerRows(this.client, plan.select, batchSize, (request) => {
      this.request = request
    })
    for await (const batch of stream) {
      this.rowCounts.set(table.sqlName, (this.rowCounts.get(table.sqlName) ?? 0) + batch.length)
      yield batch.map((row) =>
        row.map((value, index) => sqlServerValueLiteral(plan.kinds[index] ?? 'text', value))
      )
    }
  }

  beforeRows(table: DumpTableInfo): DumpStatement[] {
    const keys = this.loadingForeignKeys(table)
    return [
      ...(table.explicitIdentity ? [{ sql: `SET IDENTITY_INSERT ${table.sqlName} ON` }] : []),
      ...(keys ? [{ sql: `ALTER TABLE ${table.sqlName} NOCHECK CONSTRAINT ${keys}` }] : [])
    ]
  }

  async afterRows(table: DumpTableInfo): Promise<DumpStatement[]> {
    const keys = this.loadingForeignKeys(table)
    const statements = [
      ...(keys ? [{ sql: `ALTER TABLE ${table.sqlName} CHECK CONSTRAINT ${keys}` }] : []),
      ...(await this.sequences.states(table, this.notes))
    ]
    if (!table.explicitIdentity) {
      return statements
    }
    const [identity] = await querySqlServerRows(this.client, IDENTITY_SQL, parametersOf(table))
    const last = identity?.last_value
    // Why reseed: the next row must not take a number the source already handed out.
    // An empty table starts at the reseed value itself, one that has rows after it.
    const reseed =
      typeof last === 'string'
        ? (this.rowCounts.get(table.sqlName) ?? 0) > 0
          ? BigInt(last)
          : BigInt(last) + BigInt(catalogText(identity?.increment))
        : null
    return [
      ...statements,
      { sql: `SET IDENTITY_INSERT ${table.sqlName} OFF` },
      ...(reseed === null
        ? []
        : [
            {
              sql: `DBCC CHECKIDENT (${sqlServerTextLiteral(table.sqlName)}, RESEED, ${reseed.toString()})`
            }
          ])
    ]
  }

  async view(view: { schema: string; name: string }): Promise<DumpViewDefinition> {
    const definition = await this.definition(view)
    const sqlName = `${q(view.schema)}.${q(view.name)}`
    return {
      definition,
      create: [{ sql: definition }],
      drop: {
        sql: `IF OBJECT_ID(${sqlServerTextLiteral(sqlName)}, N'V') IS NOT NULL DROP VIEW ${sqlName}`
      }
    }
  }

  async routine(routine: Extract<DatabaseDumpObject, { kind: 'routine' }>) {
    const sqlName = `${q(routine.schema)}.${q(routine.name)}`
    const kind = routine.routineKind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
    return {
      create: [{ sql: await this.definition(routine) }],
      drop: {
        sql: `IF OBJECT_ID(${sqlServerTextLiteral(sqlName)}) IS NOT NULL DROP ${kind} ${sqlName}`
      }
    }
  }

  dropTables(tables: readonly DumpTableInfo[]): DumpStatement[] {
    return sqlServerDropTables(tables)
  }

  cancel(): void {
    if (this.request) {
      this.client.cancel()
    }
  }

  private loadingForeignKeys(table: DumpTableInfo): string | null {
    const keys = this.plans.get(table.sqlName)?.foreignKeys ?? []
    return this.checksOffWhileLoading && keys.length > 0 ? keys.map(q).join(', ') : null
  }

  private triggerStatements(table: DumpTableInfo, trigger: CatalogRow): DumpStatement[] {
    const name = catalogText(trigger.name)
    if (typeof trigger.definition !== 'string') {
      this.notes.push(
        `Trigger ${table.schema}.${name} was left out: its definition is encrypted or hidden from this user.`
      )
      return []
    }
    return [
      { sql: trigger.definition.trim() },
      ...(trigger.is_disabled === true
        ? [{ sql: `DISABLE TRIGGER ${q(table.schema)}.${q(name)} ON ${table.sqlName}` }]
        : [])
    ]
  }

  private async definition(object: { schema: string; name: string }): Promise<string> {
    const [row] = await querySqlServerRows(
      this.client,
      `select object_definition(${SQL_SERVER_OBJECT_ID}) as definition`,
      parametersOf(object)
    )
    if (typeof row?.definition !== 'string') {
      throw new Error(
        `${object.schema}.${object.name} no longer exists, or its definition is encrypted or hidden from this user.`
      )
    }
    return row.definition.trim()
  }
}
