import type { Connection } from 'tedious'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import { sqlServerIndexes, sqlServerKeys, sqlServerRoutines } from './sqlserver-catalog-objects'
import { querySqlServerRows } from './sqlserver-client-factory'

const SCHEMAS_SQL = `
  select s.name, case when s.name = schema_name() then 1 else 0 end as is_current
  from sys.schemas s
  where s.name not in ('sys', 'INFORMATION_SCHEMA', 'guest') and s.name not like 'db[_]%'
  order by s.name`

const RELATIONS_SQL = `
  select o.name, o.type from sys.objects o
  join sys.schemas s on s.schema_id = o.schema_id
  where s.name = @schema and o.type in ('U', 'V') and o.is_ms_shipped = 0
  order by o.name`

const COLUMNS_SQL = `
  select c.name,
         type_name(c.user_type_id) as type_name, c.max_length, c.precision, c.scale,
         c.is_nullable, object_definition(c.default_object_id) as default_value,
         case when exists (
           select 1 from sys.index_columns ic
           join sys.indexes i on i.object_id = ic.object_id and i.index_id = ic.index_id
           where i.is_primary_key = 1 and ic.object_id = c.object_id and ic.column_id = c.column_id
         ) then 1 else 0 end as is_primary_key
  from sys.columns c
  where c.object_id = object_id(quotename(@schema) + '.' + quotename(@relation))
  order by c.column_id`

const UNICODE_TYPES = new Set(['nvarchar', 'nchar'])
const SIZED_TYPES = new Set(['varchar', 'char', 'varbinary', 'binary', ...UNICODE_TYPES])
const SCALED_TYPES = new Set(['time', 'datetime2', 'datetimeoffset'])

export function formatSqlServerColumnType(row: Record<string, unknown>): string {
  const name = String(row.type_name)
  const maxLength = Number(row.max_length)
  if (SIZED_TYPES.has(name)) {
    const length = UNICODE_TYPES.has(name) ? maxLength / 2 : maxLength
    return `${name}(${maxLength === -1 ? 'max' : length})`
  }
  if (name === 'decimal' || name === 'numeric') {
    return `${name}(${Number(row.precision)},${Number(row.scale)})`
  }
  return SCALED_TYPES.has(name) ? `${name}(${Number(row.scale)})` : name
}

export async function introspectSqlServer(
  client: Connection,
  target: DatabaseIntrospectTarget
): Promise<DatabaseIntrospectResult> {
  switch (target.level) {
    case 'schemas': {
      const rows = await querySqlServerRows(client, SCHEMAS_SQL)
      return {
        level: 'schemas',
        schemas: rows.map((row) => ({
          name: String(row.name),
          isCurrent: Number(row.is_current) === 1
        }))
      }
    }
    case 'relations': {
      const rows = await querySqlServerRows(client, RELATIONS_SQL, { schema: target.schema })
      return {
        level: 'relations',
        relations: rows.map((row) => ({
          name: String(row.name),
          kind: String(row.type).trim() === 'V' ? 'view' : 'table'
        }))
      }
    }
    case 'columns': {
      const rows = await querySqlServerRows(client, COLUMNS_SQL, {
        schema: target.schema,
        relation: target.relation
      })
      return {
        level: 'columns',
        columns: rows.map((row) => ({
          name: String(row.name),
          dataType: formatSqlServerColumnType(row),
          nullable: row.is_nullable === true,
          defaultValue: typeof row.default_value === 'string' ? row.default_value : null,
          isPrimaryKey: row.is_primary_key === 1
        }))
      }
    }
    case 'routines':
      return { level: 'routines', routines: await sqlServerRoutines(client, target.schema) }
    case 'keys':
      return { level: 'keys', keys: await sqlServerKeys(client, target.schema, target.relation) }
    case 'indexes':
      return {
        level: 'indexes',
        indexes: await sqlServerIndexes(client, target.schema, target.relation)
      }
  }
}
