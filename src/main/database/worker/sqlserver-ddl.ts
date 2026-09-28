import type { Connection } from 'tedious'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type { DatabaseKeyInfo } from '../../../shared/database/database-introspection-types'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import { catalogText, groupByName, type CatalogRow } from './catalog-row-grouping'
import { sqlServerKeys } from './sqlserver-catalog-objects'
import { querySqlServerRows } from './sqlserver-client-factory'
import { formatSqlServerColumnType } from './sqlserver-introspection'
import { sqlServerTextLiteral } from './dump/sqlserver-dump-values'

export const SQL_SERVER_OBJECT_ID = "object_id(quotename(@schema) + N'.' + quotename(@name))"
const OBJECT_ID = SQL_SERVER_OBJECT_ID

const NO_DEFINITION_MESSAGE =
  'The server didn’t return this definition; it may be encrypted, or the user may lack VIEW DEFINITION.'

const COLUMNS_SQL = `
  select c.name, type_name(c.user_type_id) as type_name, c.max_length, c.precision, c.scale,
         c.is_nullable, c.is_identity, ic.seed_value, ic.increment_value,
         cc.definition as computed, cc.is_persisted,
         dc.name as default_name, dc.definition as default_definition,
         t.is_user_defined, schema_name(t.schema_id) as type_schema,
         case when c.collation_name <> convert(sysname, databasepropertyex(db_name(), 'Collation'))
              then c.collation_name end as collation
  from sys.columns c
  join sys.types t on t.user_type_id = c.user_type_id
  left join sys.identity_columns ic on ic.object_id = c.object_id and ic.column_id = c.column_id
  left join sys.computed_columns cc on cc.object_id = c.object_id and cc.column_id = c.column_id
  left join sys.default_constraints dc
    on dc.parent_object_id = c.object_id and dc.parent_column_id = c.column_id
  where c.object_id = ${OBJECT_ID}
  order by c.column_id`

const CHECKS_SQL = `
  select name, definition from sys.check_constraints
  where parent_object_id = ${OBJECT_ID} order by name`

// What sqlServerKeys leaves out: a key's index kind, a foreign key's referential actions.
const KEY_DETAILS_SQL = `
  select k.name, i.type_desc as index_type, null as on_delete, null as on_update
  from sys.key_constraints k
  join sys.indexes i on i.object_id = k.parent_object_id and i.index_id = k.unique_index_id
  where k.parent_object_id = ${OBJECT_ID}
  union all
  select name, null, delete_referential_action_desc, update_referential_action_desc
  from sys.foreign_keys where parent_object_id = ${OBJECT_ID}`

// Indexes behind PRIMARY KEY and UNIQUE constraints come with the constraint. Only row-store
// indexes: XML, spatial and columnstore ones have their own CREATE syntax.
const INDEXES_SQL = `
  select i.name, i.is_unique, i.type_desc, i.filter_definition, c.name as column_name,
         ic.is_descending_key, ic.is_included_column
  from sys.indexes i
  join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
  join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
  where i.object_id = ${OBJECT_ID} and i.type in (1, 2)
    and i.is_primary_key = 0 and i.is_unique_constraint = 0
  order by i.name, ic.is_included_column, ic.key_ordinal, ic.index_column_id`

// SSMS's Description: the MS_Description property on the object (minor_id 0) or a column.
const COMMENTS_SQL = `
  select o.type, c.name as column_name, cast(ep.value as nvarchar(max)) as comment
  from sys.extended_properties ep
  join sys.objects o on o.object_id = ep.major_id
  left join sys.columns c on c.object_id = ep.major_id and c.column_id = ep.minor_id
  where ep.class = 1 and ep.name = N'MS_Description' and ep.major_id = ${OBJECT_ID}
    and (ep.minor_id = 0 or c.name is not null)
  order by ep.minor_id`

const COMMENT_LEVEL_TYPES: Record<string, string> = {
  U: 'TABLE',
  V: 'VIEW',
  P: 'PROCEDURE',
  PC: 'PROCEDURE',
  FN: 'FUNCTION',
  IF: 'FUNCTION',
  TF: 'FUNCTION',
  FS: 'FUNCTION',
  FT: 'FUNCTION'
}

const quote = (name: string): string => quoteSqlName(name, 'sqlserver')
const columnList = (columns: readonly string[]): string => columns.map(quote).join(', ')

function columnLine(row: CatalogRow): string {
  const name = quote(catalogText(row.name))
  if (row.computed !== null && row.computed !== undefined) {
    return `${name} AS ${catalogText(row.computed)}${row.is_persisted === true ? ' PERSISTED' : ''}`
  }
  // Why qualify user types: an unqualified name resolves in the loading user's default schema.
  const type =
    row.is_user_defined === true
      ? `${quote(catalogText(row.type_schema))}.${quote(catalogText(row.type_name))}`
      : formatSqlServerColumnType(row)
  const parts = [name, type]
  if (typeof row.collation === 'string') {
    parts.push(`COLLATE ${row.collation}`)
  }
  if (row.is_identity === true) {
    parts.push(`IDENTITY(${catalogText(row.seed_value)}, ${catalogText(row.increment_value)})`)
  }
  parts.push(row.is_nullable === true ? 'NULL' : 'NOT NULL')
  if (row.default_definition !== null && row.default_definition !== undefined) {
    parts.push(
      `CONSTRAINT ${quote(catalogText(row.default_name))} DEFAULT ${catalogText(row.default_definition)}`
    )
  }
  return parts.join(' ')
}

function referentialAction(event: 'DELETE' | 'UPDATE', action: unknown): string {
  const text = catalogText(action)
  return text === '' || text === 'NO_ACTION' ? '' : ` ON ${event} ${text.replaceAll('_', ' ')}`
}

function keyLine(key: DatabaseKeyInfo, details: CatalogRow | undefined): string {
  const name = `CONSTRAINT ${quote(key.name)}`
  if (key.kind !== 'foreign' || !key.references) {
    const kind = key.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'
    // Why say which: a NONCLUSTERED primary key must stay one, or the table's own
    // clustered index can't be created next to it.
    const index = details ? ` ${catalogText(details.index_type)}` : ''
    return `${name} ${kind}${index} (${columnList(key.columns)})`
  }
  const target = `${quote(key.references.schema)}.${quote(key.references.relation)}`
  const actions =
    referentialAction('DELETE', details?.on_delete) +
    referentialAction('UPDATE', details?.on_update)
  return `${name} FOREIGN KEY (${columnList(key.columns)}) REFERENCES ${target} (${columnList(key.references.columns)})${actions}`
}

function indexStatement(table: string, rows: readonly CatalogRow[]): string {
  const [first] = rows
  const keys = rows.filter((row) => row.is_included_column !== true)
  const included = rows.filter((row) => row.is_included_column === true)
  const keyList = keys
    .map(
      (row) =>
        `${quote(catalogText(row.column_name))}${row.is_descending_key === true ? ' DESC' : ''}`
    )
    .join(', ')
  const unique = first?.is_unique === true ? 'UNIQUE ' : ''
  const clustered = catalogText(first?.type_desc) === 'CLUSTERED' ? 'CLUSTERED ' : ''
  const include =
    included.length > 0
      ? ` INCLUDE (${columnList(included.map((row) => catalogText(row.column_name)))})`
      : ''
  const filter =
    typeof first?.filter_definition === 'string' ? ` WHERE ${first.filter_definition}` : ''
  return `CREATE ${unique}${clustered}INDEX ${quote(catalogText(first?.name))} ON ${table} (${keyList})${include}${filter};`
}

/** Sets the MS_Description of an object (level 1) or one of its columns (level 2). */
export function sqlServerCommentStatement(target: {
  schema: string
  type: string
  name: string
  column: string | null
  comment: string
}): string {
  const column =
    target.column === null
      ? ''
      : `, @level2type = N'COLUMN', @level2name = ${sqlServerTextLiteral(target.column)}`
  return `EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = ${sqlServerTextLiteral(target.comment)}, @level0type = N'SCHEMA', @level0name = ${sqlServerTextLiteral(target.schema)}, @level1type = N'${target.type}', @level1name = ${sqlServerTextLiteral(target.name)}${column};`
}

/** sp_addextendedproperty calls that restore the object's and its columns' descriptions. */
export async function sqlServerComments(
  client: Connection,
  schema: string,
  name: string
): Promise<string[]> {
  const rows = await querySqlServerRows(client, COMMENTS_SQL, { schema, name })
  return rows.flatMap((row) => {
    const type = COMMENT_LEVEL_TYPES[catalogText(row.type).trim()]
    if (!type || typeof row.comment !== 'string') {
      return []
    }
    const column = typeof row.column_name === 'string' ? row.column_name : null
    return [sqlServerCommentStatement({ schema, type, name, column, comment: row.comment })]
  })
}

export type SqlServerTableDdl = {
  create: string
  indexes: string[]
  /** ALTER TABLE … ADD CONSTRAINT statements, when asked to keep foreign keys apart. */
  foreignKeys: string[]
  /** The table's and its columns' descriptions, for after it is created. */
  comments: string[]
}

export async function sqlServerTableDdl(
  client: Connection,
  schema: string,
  relation: string,
  options: { separateForeignKeys?: boolean } = {}
): Promise<SqlServerTableDdl> {
  const parameters = { schema, name: relation }
  const columns = await querySqlServerRows(client, COLUMNS_SQL, parameters)
  const keys = await sqlServerKeys(client, schema, relation)
  const checks = await querySqlServerRows(client, CHECKS_SQL, parameters)
  const indexRows = await querySqlServerRows(client, INDEXES_SQL, parameters)
  const keyDetails = new Map(
    (await querySqlServerRows(client, KEY_DETAILS_SQL, parameters)).map((row) => [
      catalogText(row.name),
      row
    ])
  )
  const line = (key: DatabaseKeyInfo): string => keyLine(key, keyDetails.get(key.name))
  const table = `${quote(schema)}.${quote(relation)}`
  const apart = (key: DatabaseKeyInfo): boolean =>
    options.separateForeignKeys === true && key.kind === 'foreign'
  const lines = [
    ...columns.map(columnLine),
    ...keys.filter((key) => !apart(key)).map(line),
    ...checks.map(
      (row) => `CONSTRAINT ${quote(catalogText(row.name))} CHECK ${catalogText(row.definition)}`
    )
  ]
  const indexes = groupByName<CatalogRow[]>(
    indexRows,
    () => [],
    (entry, row) => [...entry, row]
  ).map((rows) => indexStatement(table, rows))
  return {
    create: `CREATE TABLE ${table} (\n${lines.map((line) => `    ${line}`).join(',\n')}\n);`,
    indexes,
    foreignKeys: keys.filter(apart).map((key) => `ALTER TABLE ${table} ADD ${line(key)};`),
    comments: await sqlServerComments(client, schema, relation)
  }
}

export async function sqlServerDdl(client: Connection, target: DatabaseDdlTarget): Promise<string> {
  const name = target.kind === 'relation' ? target.relation : target.identity
  const [kind] = await querySqlServerRows(
    client,
    `select type, object_definition(${OBJECT_ID}) as definition from sys.objects where object_id = ${OBJECT_ID}`,
    { schema: target.schema, name }
  )
  if (!kind) {
    throw new Error(`${target.schema}.${name} no longer exists.`)
  }
  if (catalogText(kind.type).trim() === 'U') {
    const table = await sqlServerTableDdl(client, target.schema, name)
    return [table.create, ...table.indexes, ...table.comments].join('\n\n')
  }
  if (typeof kind.definition !== 'string') {
    throw new Error(NO_DEFINITION_MESSAGE)
  }
  const comments = await sqlServerComments(client, target.schema, name)
  // Why GO: CREATE VIEW, PROCEDURE and FUNCTION must each be alone in a batch.
  return [kind.definition.trim(), ...comments].join('\nGO\n\n')
}
