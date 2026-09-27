import type { Connection } from 'tedious'
import type {
  DatabaseIndexInfo,
  DatabaseKeyInfo,
  DatabaseRoutineInfo
} from '../../../shared/database/database-introspection-types'
import { catalogText, groupIndexRows, groupKeyRows } from './catalog-row-grouping'
import { querySqlServerRows } from './sqlserver-client-factory'

const RELATION_ID = "object_id(quotename(@schema) + N'.' + quotename(@relation))"

// FOR XML PATH instead of STRING_AGG, which needs SQL Server 2017.
const ROUTINES_SQL = `
  select o.name, o.type,
         stuff((
           select N', ' + p.name + N' ' + type_name(p.user_type_id)
           from sys.parameters p
           where p.object_id = o.object_id and p.parameter_id > 0
           order by p.parameter_id
           for xml path(''), type
         ).value('.', 'nvarchar(max)'), 1, 2, N'') as arguments
  from sys.objects o
  join sys.schemas s on s.schema_id = o.schema_id
  where s.name = @schema and o.is_ms_shipped = 0
    and o.type in ('P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT')
  order by o.name`

// Why the derived table: a UNION can only ORDER BY columns it selects.
const KEYS_SQL = `
  select name, type, column_name, ref_schema, ref_relation, ref_column from (
    select kc.name, rtrim(kc.type) as type, c.name as column_name,
           cast(null as sysname) as ref_schema, cast(null as sysname) as ref_relation,
           cast(null as sysname) as ref_column, ic.key_ordinal as ordinal
    from sys.key_constraints kc
    join sys.index_columns ic on ic.object_id = kc.parent_object_id and ic.index_id = kc.unique_index_id
    join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
    where kc.parent_object_id = ${RELATION_ID}
    union all
    select fk.name, 'F', pc.name, schema_name(rt.schema_id), rt.name, rc.name,
           fkc.constraint_column_id
    from sys.foreign_keys fk
    join sys.foreign_key_columns fkc on fkc.constraint_object_id = fk.object_id
    join sys.columns pc on pc.object_id = fkc.parent_object_id and pc.column_id = fkc.parent_column_id
    join sys.objects rt on rt.object_id = fkc.referenced_object_id
    join sys.columns rc on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
    where fk.parent_object_id = ${RELATION_ID}
  ) keys
  order by case type when 'PK' then 0 when 'UQ' then 1 else 2 end, name, ordinal`

// Heaps (type 0) aren't indexes; INCLUDE columns aren't keys.
const INDEXES_SQL = `
  select i.name, i.is_unique, i.is_primary_key, c.name as column_name
  from sys.indexes i
  join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
  join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
  where i.object_id = ${RELATION_ID} and i.type > 0 and ic.is_included_column = 0
  order by i.is_primary_key desc, i.name, ic.key_ordinal`

const KEY_KINDS: Record<string, DatabaseKeyInfo['kind']> = {
  PK: 'primary',
  UQ: 'unique',
  F: 'foreign'
}

export async function sqlServerRoutines(
  client: Connection,
  schema: string
): Promise<DatabaseRoutineInfo[]> {
  const rows = await querySqlServerRows(client, ROUTINES_SQL, { schema })
  return rows.map((row) => {
    const type = catalogText(row.type).trim()
    return {
      name: catalogText(row.name),
      kind: type === 'P' || type === 'PC' ? 'procedure' : 'function',
      identity: catalogText(row.name),
      arguments: row.arguments === null ? '' : catalogText(row.arguments)
    }
  })
}

export async function sqlServerKeys(
  client: Connection,
  schema: string,
  relation: string
): Promise<DatabaseKeyInfo[]> {
  const rows = await querySqlServerRows(client, KEYS_SQL, { schema, relation })
  return groupKeyRows(rows, (row) => KEY_KINDS[catalogText(row.type)] ?? 'unique')
}

export async function sqlServerIndexes(
  client: Connection,
  schema: string,
  relation: string
): Promise<DatabaseIndexInfo[]> {
  const rows = await querySqlServerRows(client, INDEXES_SQL, { schema, relation })
  return groupIndexRows(rows, (row) => ({
    unique: row.is_unique === true,
    primary: row.is_primary_key === true
  }))
}
