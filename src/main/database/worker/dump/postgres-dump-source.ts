import type pg from 'pg'
import Cursor from 'pg-cursor'
import { qualifiedRelationName, quoteSqlName } from '../../../../shared/database/sql-identifiers'
import { POSTGRES_RELATION_SQL, postgresDdl, postgresTableDdl } from '../postgres-ddl'
import type { DumpSource, DumpTableInfo, DumpTableStructure } from './dump-source'
import {
  postgresSequenceValues,
  postgresTableRequirements,
  postgresTextLiteral
} from './postgres-dump-catalog'

const q = (name: string): string => quoteSqlName(name, 'postgres')

const COLUMNS_SQL = (version: number): string => `
  select attname as name,
         ${version >= 100_000 ? 'attidentity' : "''"}::text as identity,
         ${version >= 120_000 ? 'attgenerated' : "''"}::text as generated
  from pg_catalog.pg_attribute
  where attrelid = $1::oid and attnum > 0 and not attisdropped
  order by attnum`

const REFERENCES_SQL = `
  select distinct n.nspname as schema, c.relname as name
  from pg_catalog.pg_constraint k
  join pg_catalog.pg_class c on c.oid = k.confrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where k.conrelid = $1::oid and k.contype = 'f'`

const TRIGGERS_SQL = `
  select pg_catalog.pg_get_triggerdef(oid, true) as definition
  from pg_catalog.pg_trigger where tgrelid = $1::oid and not tgisinternal order by tgname`

type Relation = { oid: number; relkind: string }

/** PostgreSQL's reads for a dump, in one read-only REPEATABLE READ snapshot (as pg_dump reads). */
export class PostgresDumpSource implements DumpSource {
  readonly dialect = 'postgres' as const
  readonly notes: string[] = []
  private readonly relations = new Map<string, Relation>()
  private readonly columnNames = new Map<string, string[]>()

  constructor(
    private readonly client: pg.Client,
    private readonly serverVersionNum: number
  ) {}

  async begin(): Promise<void> {
    await this.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  }

  async end(): Promise<void> {
    await this.client.query('COMMIT')
  }

  async close(): Promise<void> {
    await this.client.end()
  }

  settings(options: { foreignKeyChecksOff: boolean; dataOnly: boolean }): {
    before: { sql: string }[]
    after: { sql: string }[]
  } {
    const before = [
      { sql: "SET client_encoding = 'UTF8'" },
      { sql: 'SET standard_conforming_strings = on' },
      // Why: a function body may name tables or functions created later in the script.
      { sql: 'SET check_function_bodies = false' }
    ]
    // Why replica: rows can't be ordered around keys that already exist and reference each
    // other; a structure dump defers its keys instead, which needs no privilege.
    if (!options.dataOnly || !options.foreignKeyChecksOff) {
      return { before, after: [] }
    }
    if (!this.notes.some((note) => note.includes('session_replication_role'))) {
      this.notes.push(
        'The export sets session_replication_role to replica to skip foreign key checks while loading; that takes a superuser (or, from PostgreSQL 15, SET privilege on it).'
      )
    }
    return {
      before: [...before, { sql: 'SET session_replication_role = replica' }],
      after: [{ sql: 'SET session_replication_role = DEFAULT' }]
    }
  }

  createSchema(schema: string): { sql: string }[] {
    return schema === 'public' ? [] : [{ sql: `CREATE SCHEMA IF NOT EXISTS ${q(schema)}` }]
  }

  enterSchema(): { sql: string }[] {
    return []
  }

  async tableInfo(table: { schema: string; name: string }): Promise<DumpTableInfo> {
    const relation = await this.relation(table)
    const columns = await this.client.query<{ name: string; identity: string; generated: string }>(
      COLUMNS_SQL(this.serverVersionNum),
      [relation.oid]
    )
    const references = await this.client.query<{ schema: string; name: string }>(REFERENCES_SQL, [
      relation.oid
    ])
    const insertable = columns.rows.filter((column) => column.generated === '')
    const sqlName = qualifiedRelationName(table.schema, table.name, 'postgres')
    if (relation.relkind === 'p') {
      this.notes.push(
        `${sqlName} is partitioned and its partitions are not in the dump, so its rows load only into a copy that already has them.`
      )
    }
    this.columnNames.set(
      sqlName,
      insertable.map((column) => column.name)
    )
    return {
      ...table,
      sqlName,
      columns: insertable.map((column) => q(column.name)),
      explicitIdentity: insertable.some((column) => column.identity === 'a'),
      references: references.rows
    }
  }

  async tableStructure(
    table: DumpTableInfo,
    separateForeignKeys: boolean
  ): Promise<DumpTableStructure> {
    const relation = await this.relation(table)
    const ddl = await postgresTableDdl(
      this.client,
      { ...relation, name: table.sqlName },
      this.serverVersionNum,
      { separateForeignKeys }
    )
    const needs = await postgresTableRequirements(this.client, {
      oid: relation.oid,
      sqlName: table.sqlName
    })
    const triggers = await this.client.query<{ definition: string }>(TRIGGERS_SQL, [relation.oid])
    return {
      requires: needs.requires.map((sql) => ({ sql })),
      create: [ddl.create, ...needs.ownedBy, ...ddl.indexes].map((sql) => ({ sql })),
      foreignKeys: ddl.foreignKeys.map((sql) => ({ sql })),
      triggers: triggers.rows.map((row) => ({ sql: row.definition }))
    }
  }

  async *rows(table: DumpTableInfo, batchSize: number): AsyncIterable<string[][]> {
    const names = this.columnNames.get(table.sqlName) ?? []
    if (names.length === 0) {
      return
    }
    // Why as text: every type's text form reads back into it, so nothing is rounded or lost.
    const select = names.map((name) => `${q(name)}::text`).join(', ')
    const cursor = this.client.query(
      new Cursor<unknown[]>(`select ${select} from ${table.sqlName}`, [], { rowMode: 'array' })
    )
    try {
      for (;;) {
        const rows = await cursor.read(batchSize)
        if (rows.length === 0) {
          return
        }
        yield rows.map((row) =>
          row.map((value) => (value === null ? 'NULL' : postgresTextLiteral(String(value))))
        )
      }
    } finally {
      await cursor.close()
    }
  }

  beforeRows(): { sql: string }[] {
    return []
  }

  async afterRows(table: DumpTableInfo): Promise<{ sql: string }[]> {
    const relation = await this.relation(table)
    const values = await postgresSequenceValues(this.client, {
      oid: relation.oid,
      sqlName: table.sqlName
    })
    return values.map((sql) => ({ sql }))
  }

  async view(view: { schema: string; name: string }) {
    const relation = await this.relation(view)
    const sqlName = qualifiedRelationName(view.schema, view.name, 'postgres')
    const definition = await postgresDdl(
      this.client,
      { kind: 'relation', schema: view.schema, relation: view.name },
      this.serverVersionNum
    )
    const materialized = relation.relkind === 'm'
    return {
      definition,
      create: definition.split(/\n\n(?=CREATE )/).map((sql) => ({ sql })),
      drop: { sql: `DROP ${materialized ? 'MATERIALIZED VIEW' : 'VIEW'} IF EXISTS ${sqlName}` }
    }
  }

  async routine(routine: {
    identity: string
    routineKind: 'function' | 'procedure'
    schema: string
  }) {
    const definition = await postgresDdl(
      this.client,
      {
        kind: 'routine',
        schema: routine.schema,
        identity: routine.identity,
        routineKind: routine.routineKind
      },
      this.serverVersionNum
    )
    const kind = routine.routineKind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
    return {
      create: { sql: definition },
      drop: { sql: `DROP ${kind} IF EXISTS ${routine.identity}` }
    }
  }

  dropTables(tables: readonly DumpTableInfo[]): { sql: string }[] {
    // Why one statement: tables that reference each other can only be dropped together.
    return tables.length === 0
      ? []
      : [{ sql: `DROP TABLE IF EXISTS ${tables.map((table) => table.sqlName).join(', ')}` }]
  }

  // Why nothing: rows come in short batches, and the runner stops between them.
  cancel(): void {}

  private async relation(table: { schema: string; name: string }): Promise<Relation> {
    const key = JSON.stringify([table.schema, table.name])
    const known = this.relations.get(key)
    if (known) {
      return known
    }
    const result = await this.client.query<Relation>(POSTGRES_RELATION_SQL, [
      table.schema,
      table.name
    ])
    const relation = result.rows[0]
    if (!relation) {
      throw new Error(`${table.schema}.${table.name} no longer exists.`)
    }
    this.relations.set(key, relation)
    return relation
  }
}
