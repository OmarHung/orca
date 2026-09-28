import type { Connection } from 'tedious'
import { quoteSqlName } from '../../../../shared/database/sql-identifiers'
import { catalogText, type CatalogRow } from '../catalog-row-grouping'
import { querySqlServerRows } from '../sqlserver-client-factory'
import { SQL_SERVER_OBJECT_ID } from '../sqlserver-ddl'
import { formatSqlServerColumnType } from '../sqlserver-introspection'
import type { DumpStatement } from './dump-output'
import { sqlServerTextLiteral } from './sqlserver-dump-values'

const q = (name: string): string => quoteSqlName(name, 'sqlserver')

/** Sequences the table's defaults take values from (DEFAULT NEXT VALUE FOR …). */
export const DEFAULT_SEQUENCE_IDS = `
  select dep.referenced_id from sys.sql_expression_dependencies dep
  join sys.default_constraints d on d.object_id = dep.referencing_id
  where d.parent_object_id = ${SQL_SERVER_OBJECT_ID}`

// Whether sys.sequences has last_used_value (SQL Server 2017 and later).
const LAST_USED_COLUMN_SQL = "select col_length('sys.sequences', 'last_used_value') as length"

const sequencesSql = (hasLastUsed: boolean): string => `
  select schema_name(s.schema_id) as sequence_schema, s.name,
         type_name(s.system_type_id) as type_name, s.precision, s.scale,
         case when t.is_user_defined = 1 then schema_name(t.schema_id) end as alias_schema,
         t.name as alias_name,
         cast(s.start_value as nvarchar(50)) as start_value,
         cast(s.increment as nvarchar(50)) as increment,
         cast(s.minimum_value as nvarchar(50)) as minimum_value,
         cast(s.maximum_value as nvarchar(50)) as maximum_value,
         cast(s.current_value as nvarchar(50)) as current_value,
         ${hasLastUsed ? 'cast(s.last_used_value as nvarchar(50))' : 'null'} as last_used_value,
         s.is_cycling, s.is_cached, s.cache_size
  from sys.sequences s join sys.types t on t.user_type_id = s.user_type_id
  where s.object_id in (${DEFAULT_SEQUENCE_IDS})
  order by sequence_schema, s.name`

export type SequenceNumbers = {
  start: bigint
  increment: bigint
  minimum: bigint
  maximum: bigint
  current: bigint
  cycling: boolean
}

/**
 * How many values the sequence handed out, counting from its start, to stand at `current`; null
 * when no run from its start gets there (its increment or range was altered since).
 */
export function valuesHandedOut(sequence: SequenceNumbers): bigint | null {
  const { start, increment, minimum, maximum, current } = sequence
  const steps = (from: bigint, to: bigint): bigint | null =>
    (to - from) % increment === 0n && (to - from) / increment >= 0n
      ? (to - from) / increment + 1n
      : null
  const firstRun = steps(start, current)
  if (firstRun !== null || !sequence.cycling) {
    return firstRun
  }
  // A cycling sequence starts over at its minimum (its maximum when counting down).
  const ascending = increment > 0n
  const firstRunLength = ascending
    ? (maximum - start) / increment + 1n
    : (start - minimum) / -increment + 1n
  const again = steps(ascending ? minimum : maximum, current)
  return again === null ? null : firstRunLength + again
}

function sequenceName(row: CatalogRow): string {
  return `${q(catalogText(row.sequence_schema))}.${q(catalogText(row.name))}`
}

function sequenceNumber(row: CatalogRow, column: string): bigint {
  const text = catalogText(row[column])
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`Sequence ${sequenceName(row)} has a ${column} of ${text}, not a whole number.`)
  }
  return BigInt(text)
}

function numbersOf(row: CatalogRow): SequenceNumbers {
  return {
    start: sequenceNumber(row, 'start_value'),
    increment: sequenceNumber(row, 'increment'),
    minimum: sequenceNumber(row, 'minimum_value'),
    maximum: sequenceNumber(row, 'maximum_value'),
    current: sequenceNumber(row, 'current_value'),
    cycling: row.is_cycling === true
  }
}

type Placement = { start: bigint; handedOut: bigint; note: string | null }

/**
 * Where the loaded sequence starts, and how many values it hands out from there to stand where
 * the source's does. `hasLastUsed` is false before SQL Server 2017, whose catalog can't tell an
 * unused sequence from one that handed out only its start value.
 */
function placement(row: CatalogRow, hasLastUsed: boolean): Placement {
  const name = sequenceName(row)
  const numbers = numbersOf(row)
  if (hasLastUsed && (row.last_used_value === null || row.last_used_value === undefined)) {
    return { start: numbers.current, handedOut: 0n, note: null }
  }
  const handedOut = valuesHandedOut(numbers)
  if (handedOut === null) {
    return {
      start: numbers.current,
      handedOut: 1n,
      note: `Sequence ${name} continues from its current value, but it can't be reached from its start value ${numbers.start} (its increment or range changed since), so the loaded sequence's start value is ${numbers.current}.`
    }
  }
  return {
    start: numbers.start,
    handedOut,
    note:
      !hasLastUsed && numbers.current === numbers.start
        ? `This server can't tell whether sequence ${name} handed out its start value ${numbers.start}; the loaded sequence treats it as handed out and continues after it.`
        : null
  }
}

/**
 * Runs before the conditional CREATE SEQUENCE, which keeps a sequence the target already has: one
 * defined otherwise stops the load or, with `dropExisting`, is dropped when nothing else uses it.
 * Why the base type: RESTART turns an alias-typed sequence into its base type.
 */
export function sequenceGuardStatement(row: CatalogRow, dropExisting: boolean): DumpStatement {
  const name = sequenceName(row)
  const literal = sqlServerTextLiteral(name)
  const { increment, minimum, maximum, cycling } = numbersOf(row)
  const cacheSize =
    row.cache_size === null || row.cache_size === undefined
      ? 'cache_size IS NULL'
      : `cache_size = ${Number(row.cache_size)}`
  const matches = [
    `system_type_id = TYPE_ID(${sqlServerTextLiteral(catalogText(row.type_name))})`,
    `precision = ${Number(row.precision)}`,
    `scale = ${Number(row.scale)}`,
    `increment = ${increment}`,
    `minimum_value = ${minimum}`,
    `maximum_value = ${maximum}`,
    `is_cycling = ${cycling ? 1 : 0}`,
    row.is_cached === true ? `is_cached = 1 AND ${cacheSize}` : 'is_cached = 0'
  ].join(' AND ')
  const differs = `EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(${literal}) AND NOT (${matches}))`
  const refuse = (why: string): string =>
    `THROW 50000, ${sqlServerTextLiteral(`Sequence ${name} already exists with a definition other than the dumped one${why}`)}, 1`
  if (!dropExisting) {
    return {
      sql: `IF ${differs} ${refuse('. Drop it, or dump again dropping existing objects first.')}`
    }
  }
  const used = `EXISTS (SELECT 1 FROM sys.sql_expression_dependencies WHERE referenced_id = OBJECT_ID(${literal}))`
  return {
    sql: `IF ${differs}\nBEGIN\nIF ${used} ${refuse(", and other objects use it, so the dump can't replace it.")};\nDROP SEQUENCE ${name};\nEND`
  }
}

/** CREATE SEQUENCE with the source's type, start, step, range, cycling and cache. */
export function sequenceCreateStatement(row: CatalogRow, hasLastUsed: boolean): DumpStatement {
  const name = sequenceName(row)
  const type =
    typeof row.alias_schema === 'string'
      ? `${q(row.alias_schema)}.${q(catalogText(row.alias_name))}`
      : formatSqlServerColumnType(row)
  const { increment, minimum, maximum, cycling } = numbersOf(row)
  const cache =
    row.is_cached !== true
      ? 'NO CACHE'
      : row.cache_size === null || row.cache_size === undefined
        ? 'CACHE'
        : `CACHE ${Number(row.cache_size)}`
  return {
    sql: `IF OBJECT_ID(${sqlServerTextLiteral(name)}, N'SO') IS NULL CREATE SEQUENCE ${name} AS ${type} START WITH ${placement(row, hasLastUsed).start} INCREMENT BY ${increment} MINVALUE ${minimum} MAXVALUE ${maximum} ${cycling ? 'CYCLE' : 'NO CYCLE'} ${cache}`
  }
}

/**
 * Puts the sequence where the source's stands: at its start, then past every value it handed
 * out, so its start value and its next value both match.
 */
export function sequenceStateStatement(
  row: CatalogRow,
  hasLastUsed: boolean
): { statement: DumpStatement; note: string | null } {
  const name = sequenceName(row)
  const literal = sqlServerTextLiteral(name)
  const { start, handedOut, note } = placement(row, hasLastUsed)
  const exists = (condition: string): string =>
    `EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(${literal}) AND ${condition})`
  // Why only once it has moved: RESTART turns an alias-typed sequence into its base type, and
  // one the dump just created stands at its start already.
  const moved = `start_value <> ${start} OR current_value <> ${start}${hasLastUsed ? ' OR last_used_value IS NOT NULL' : ''}`
  const restart = `IF ${exists(`(${moved})`)} ALTER SEQUENCE ${name} RESTART WITH ${start}`
  if (handedOut === 0n) {
    return { statement: { sql: restart }, note }
  }
  // Why a range, not NEXT VALUE FOR in a loop: one call takes any number of values.
  const take = `DECLARE @orca_first_value sql_variant;
EXEC sys.sp_sequence_get_range @sequence_name = ${literal}, @range_size = ${handedOut}, @range_first_value = @orca_first_value OUTPUT`
  if (!hasLastUsed) {
    return { statement: { sql: `${restart};\n${take}` }, note }
  }
  // Loading the same dump again finds it in place and leaves it, alias type and all.
  const current = numbersOf(row).current
  const placed = `start_value = ${start} AND current_value = ${current} AND last_used_value = ${current}`
  return {
    statement: { sql: `IF NOT ${exists(placed)}\nBEGIN\n${restart};\n${take};\nEND` },
    note
  }
}

/** A dump's reads of the sequences its tables' defaults draw from. */
export class SqlServerDumpSequences {
  /** Sequences whose state the dump already wrote; several tables may draw from one. */
  private readonly placed = new Set<string>()
  private lastUsedColumn: Promise<boolean> | null = null

  constructor(private readonly client: Connection) {}

  /** CREATE SEQUENCE for each, before the table that needs it, once one there is checked. */
  async creates(
    table: { schema: string; name: string },
    dropExisting: boolean
  ): Promise<DumpStatement[]> {
    const { sequences, hasLastUsed } = await this.read(table)
    return sequences.flatMap((row) => [
      sequenceGuardStatement(row, dropExisting),
      sequenceCreateStatement(row, hasLastUsed)
    ])
  }

  /**
   * Each sequence's state, the first time a table draws from it. Why read after the table's
   * rows: sequences aren't transactional, so they already stand past every value the rows hold.
   */
  async states(table: { schema: string; name: string }, notes: string[]): Promise<DumpStatement[]> {
    const { sequences, hasLastUsed } = await this.read(table)
    const statements: DumpStatement[] = []
    for (const row of sequences.filter((sequence) => !this.placed.has(sequenceName(sequence)))) {
      this.placed.add(sequenceName(row))
      const { statement, note } = sequenceStateStatement(row, hasLastUsed)
      statements.push(statement)
      if (note) {
        notes.push(note)
      }
    }
    return statements
  }

  private async read(table: {
    schema: string
    name: string
  }): Promise<{ sequences: CatalogRow[]; hasLastUsed: boolean }> {
    this.lastUsedColumn ??= querySqlServerRows(this.client, LAST_USED_COLUMN_SQL).then(
      ([row]) => row?.length !== null && row?.length !== undefined
    )
    const hasLastUsed = await this.lastUsedColumn
    const sequences = await querySqlServerRows(this.client, sequencesSql(hasLastUsed), {
      schema: table.schema,
      name: table.name
    })
    return { sequences, hasLastUsed }
  }
}
