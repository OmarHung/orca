import type { Connection } from 'tedious'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type { DatabaseKeyInfo } from '../../../shared/database/database-introspection-types'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import { catalogText, groupByName, type CatalogRow } from './catalog-row-grouping'
import { sqlServerKeys } from './sqlserver-catalog-objects'
import { querySqlServerRows } from './sqlserver-client-factory'
import { formatSqlServerColumnType } from './sqlserver-introspection'

const OBJECT_ID = "object_id(quotename(@schema) + N'.' + quotename(@name))"

const NO_DEFINITION_MESSAGE =
  'The server didn’t return this definition; it may be encrypted, or the user may lack VIEW DEFINITION.'

const COLUMNS_SQL = `
  select c.name, type_name(c.user_type_id) as type_name, c.max_length, c.precision, c.scale,
         c.is_nullable, c.is_identity, ic.seed_value, ic.increment_value,
         cc.definition as computed, cc.is_persisted,
         dc.name as default_name, dc.definition as default_definition
  from sys.columns c
  left join sys.identity_columns ic on ic.object_id = c.object_id and ic.column_id = c.column_id
  left join sys.computed_columns cc on cc.object_id = c.object_id and cc.column_id = c.column_id
  left join sys.default_constraints dc
    on dc.parent_object_id = c.object_id and dc.parent_column_id = c.column_id
  where c.object_id = ${OBJECT_ID}
  order by c.column_id`

const CHECKS_SQL = `
  select name, definition from sys.check_constraints
  where parent_object_id = ${OBJECT_ID} order by name`

// Indexes behind PRIMARY KEY and UNIQUE constraints come with the constraint.
const INDEXES_SQL = `
  select i.name, i.is_unique, i.type_desc, c.name as column_name
  from sys.indexes i
  join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
  join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
  where i.object_id = ${OBJECT_ID} and i.type > 0 and ic.is_included_column = 0
    and i.is_primary_key = 0 and i.is_unique_constraint = 0
  order by i.name, ic.key_ordinal`

const quote = (name: string): string => quoteSqlName(name, 'sqlserver')
const columnList = (columns: readonly string[]): string => columns.map(quote).join(', ')

function columnLine(row: CatalogRow): string {
  const name = quote(catalogText(row.name))
  if (row.computed !== null && row.computed !== undefined) {
    return `${name} AS ${catalogText(row.computed)}${row.is_persisted === true ? ' PERSISTED' : ''}`
  }
  const parts = [name, formatSqlServerColumnType(row)]
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

function keyLine(key: DatabaseKeyInfo): string {
  const name = `CONSTRAINT ${quote(key.name)}`
  if (key.kind !== 'foreign' || !key.references) {
    return `${name} ${key.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'} (${columnList(key.columns)})`
  }
  const target = `${quote(key.references.schema)}.${quote(key.references.relation)}`
  return `${name} FOREIGN KEY (${columnList(key.columns)}) REFERENCES ${target} (${columnList(key.references.columns)})`
}

async function tableDdl(client: Connection, schema: string, relation: string): Promise<string> {
  const parameters = { schema, name: relation }
  const columns = await querySqlServerRows(client, COLUMNS_SQL, parameters)
  const keys = await sqlServerKeys(client, schema, relation)
  const checks = await querySqlServerRows(client, CHECKS_SQL, parameters)
  const indexRows = await querySqlServerRows(client, INDEXES_SQL, parameters)
  const table = `${quote(schema)}.${quote(relation)}`
  const lines = [
    ...columns.map(columnLine),
    ...keys.map(keyLine),
    ...checks.map(
      (row) => `CONSTRAINT ${quote(catalogText(row.name))} CHECK ${catalogText(row.definition)}`
    )
  ]
  const indexes = groupByName<{ row: CatalogRow; columns: string[] }>(
    indexRows,
    (row) => ({ row, columns: [] }),
    (entry, row) => ({ ...entry, columns: [...entry.columns, catalogText(row.column_name)] })
  ).map(({ row, columns: indexColumns }) => {
    const unique = row.is_unique === true ? 'UNIQUE ' : ''
    const clustered = catalogText(row.type_desc) === 'CLUSTERED' ? 'CLUSTERED ' : ''
    return `CREATE ${unique}${clustered}INDEX ${quote(catalogText(row.name))} ON ${table} (${columnList(indexColumns)});`
  })
  const create = `CREATE TABLE ${table} (\n${lines.map((line) => `    ${line}`).join(',\n')}\n);`
  return [create, ...indexes].join('\n\n')
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
    return tableDdl(client, target.schema, name)
  }
  if (typeof kind.definition !== 'string') {
    throw new Error(NO_DEFINITION_MESSAGE)
  }
  return kind.definition.trim()
}
