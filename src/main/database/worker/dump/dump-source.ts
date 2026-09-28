import type { DatabaseDumpObject } from '../../../../shared/database/database-dump-types'
import type { SqlDialect } from '../../../../shared/database/sql-dialect-lexing'
import type { DumpTableNode } from './dump-order'
import type { DumpStatement } from './dump-output'

export type DumpTableInfo = DumpTableNode & {
  /** The table as SQL names it, qualified as the dialect needs. */
  sqlName: string
  /** Quoted columns an INSERT can name; generated and rowversion columns are left out. */
  columns: string[]
  /** Rows carry identity values: PostgreSQL's GENERATED ALWAYS, SQL Server's IDENTITY. */
  explicitIdentity: boolean
}

export type DumpTableStructure = {
  /** Types and sequences it needs first; one statement several tables need is written once. */
  requires: DumpStatement[]
  create: DumpStatement[]
  /** Foreign keys as ALTER TABLE statements, when asked to keep them apart from `create`. */
  foreignKeys: DumpStatement[]
  triggers: DumpStatement[]
}

export type DumpStructureOptions = {
  /** Foreign keys as ALTER TABLE statements in `foreignKeys`, not inline. */
  separateForeignKeys: boolean
  /** The script drops what it replaces, so a `requires` object defined otherwise may be rebuilt. */
  dropExisting: boolean
}

export type DumpViewDefinition = {
  /** The view's text, read to order views that select from views. */
  definition: string
  create: DumpStatement[]
  drop: DumpStatement
}

/**
 * One driver's reads for a dump, on a session of its own. Every value it returns is already
 * SQL for the target dialect: quoted names, literals, whole statements.
 */
export type DumpSource = {
  readonly dialect: SqlDialect
  /** Things the dump could not carry exactly, for the summary. */
  readonly notes: string[]
  /** Starts one consistent read (a snapshot) for everything that follows, where it can. */
  begin(): Promise<void>
  end(): Promise<void>
  close(): Promise<void>
  /**
   * Session settings each script starts with, and what it ends with. `dataOnly` loads rows
   * into tables that already have their foreign keys.
   */
  settings(options: { foreignKeyChecksOff: boolean; dataOnly: boolean }): {
    before: DumpStatement[]
    after: DumpStatement[]
  }
  createSchema(schema: string, schemaCount: number): DumpStatement[]
  /** Statements that make `schema` current for unqualified names (MySQL's USE). */
  enterSchema(schema: string, schemaCount: number): DumpStatement[]
  tableInfo(table: { schema: string; name: string }): Promise<DumpTableInfo>
  tableStructure(table: DumpTableInfo, options: DumpStructureOptions): Promise<DumpTableStructure>
  /** The table's rows in batches, each value already a literal. */
  rows(table: DumpTableInfo, batchSize: number): AsyncIterable<string[][]>
  /** Around a table's rows: SQL Server's IDENTITY_INSERT, PostgreSQL's setval after them. */
  beforeRows(table: DumpTableInfo): DumpStatement[]
  afterRows(table: DumpTableInfo): Promise<DumpStatement[]>
  view(view: { schema: string; name: string }): Promise<DumpViewDefinition>
  /** `create` may set up the session the routine was made in around its CREATE, and put it back. */
  routine(
    routine: Extract<DatabaseDumpObject, { kind: 'routine' }>
  ): Promise<{ create: DumpStatement[]; drop: DumpStatement }>
  /**
   * DROP statements for these tables, given in reverse creation order, from whatever schema the
   * script is in: with several schemas each table must be named in its own.
   */
  dropTables(tables: readonly DumpTableInfo[], schemaCount: number): DumpStatement[]
  /** Stops a read in flight. */
  cancel(): void
}
