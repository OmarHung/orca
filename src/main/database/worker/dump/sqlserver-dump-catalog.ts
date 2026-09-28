import { quoteSqlName } from '../../../../shared/database/sql-identifiers'
import { catalogText, type CatalogRow } from '../catalog-row-grouping'
import { SQL_SERVER_OBJECT_ID } from '../sqlserver-ddl'
import { formatSqlServerColumnType } from '../sqlserver-introspection'
import type { DumpStatement } from './dump-output'
import type { DumpTableInfo } from './dump-source'
import { DEFAULT_SEQUENCE_IDS } from './sqlserver-dump-sequences'
import { sqlServerTextLiteral } from './sqlserver-dump-values'

const q = (name: string): string => quoteSqlName(name, 'sqlserver')

export const COLUMNS_SQL = `
  select c.name, type_name(c.system_type_id) as base_type, t.is_assembly_type,
         c.is_computed, c.is_identity
  from sys.columns c join sys.types t on t.user_type_id = c.user_type_id
  where c.object_id = ${SQL_SERVER_OBJECT_ID} order by c.column_id`

export const FOREIGN_KEYS_SQL = `
  select fk.name, schema_name(r.schema_id) as ref_schema, r.name as ref_name
  from sys.foreign_keys fk join sys.objects r on r.object_id = fk.referenced_object_id
  where fk.parent_object_id = ${SQL_SERVER_OBJECT_ID}`

// Alias types of the table's columns and of the sequences its defaults draw from.
export const ALIAS_TYPES_SQL = `
  select schema_name(t.schema_id) as type_schema, t.name,
         type_name(t.system_type_id) as type_name, t.max_length, t.precision, t.scale, t.is_nullable
  from sys.types t
  where t.is_user_defined = 1 and t.is_assembly_type = 0 and t.is_table_type = 0
    and (t.user_type_id in (select c.user_type_id from sys.columns c
                            where c.object_id = ${SQL_SERVER_OBJECT_ID})
      or t.user_type_id in (select s.user_type_id from sys.sequences s
                            where s.object_id in (${DEFAULT_SEQUENCE_IDS})))
  order by type_schema, t.name`

export const TRIGGERS_SQL = `
  select name, object_definition(object_id) as definition, is_disabled
  from sys.triggers where parent_id = ${SQL_SERVER_OBJECT_ID} order by name`

export const IDENTITY_SQL = `
  select cast(last_value as varchar(40)) as last_value,
         cast(increment_value as varchar(40)) as increment
  from sys.identity_columns where object_id = ${SQL_SERVER_OBJECT_ID}`

export const parametersOf = (object: { schema: string; name: string }) => ({
  schema: object.schema,
  name: object.name
})

export function aliasTypeStatement(row: CatalogRow): DumpStatement {
  const name = `${q(catalogText(row.type_schema))}.${q(catalogText(row.name))}`
  const nullable = row.is_nullable === true ? 'NULL' : 'NOT NULL'
  return {
    sql: `IF TYPE_ID(${sqlServerTextLiteral(name)}) IS NULL CREATE TYPE ${name} FROM ${formatSqlServerColumnType(row)} ${nullable}`
  }
}

export function sqlServerDropTables(tables: readonly DumpTableInfo[]): DumpStatement[] {
  if (tables.length === 0) {
    return []
  }
  // Why drop their foreign keys first: tables that reference each other can't otherwise go.
  const ids = tables.map((table) => `OBJECT_ID(${sqlServerTextLiteral(table.sqlName)})`).join(', ')
  const dropKeys = `DECLARE @orca_sql nvarchar(max) = N'';
SELECT @orca_sql = @orca_sql + N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N'; '
FROM sys.foreign_keys WHERE parent_object_id IN (${ids});
EXEC sys.sp_executesql @orca_sql`
  return [
    { sql: dropKeys },
    ...tables.map((table) => ({
      sql: `IF OBJECT_ID(${sqlServerTextLiteral(table.sqlName)}, N'U') IS NOT NULL DROP TABLE ${table.sqlName}`
    }))
  ]
}
