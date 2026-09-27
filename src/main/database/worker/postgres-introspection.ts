import type pg from 'pg'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseRelationKind
} from '../../../shared/database/database-introspection-types'

const POSTGRES_10 = 100_000

const SCHEMAS_SQL = `
  select nspname as name
  from pg_catalog.pg_namespace
  where nspname !~ '^pg_' and nspname <> 'information_schema'
  order by nspname`

function relationsSql(serverVersionNum: number): string {
  // Why: partitions are listed under their parent in DataGrip; relispartition needs PG 10.
  const hidePartitions = serverVersionNum >= POSTGRES_10 ? 'and not c.relispartition' : ''
  return `
    select c.relname as name, c.relkind as kind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm', 'f') ${hidePartitions}
    order by c.relname`
}

const COLUMNS_SQL = `
  select a.attname as name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
         not a.attnotnull as nullable,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_value,
         exists (
           select 1 from pg_catalog.pg_index i
           where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)
         ) as is_primary_key
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
  order by a.attnum`

const RELATION_KINDS: Record<string, DatabaseRelationKind> = {
  r: 'table',
  p: 'partitioned-table',
  v: 'view',
  m: 'materialized-view',
  f: 'foreign-table'
}

type ColumnRow = {
  name: string
  data_type: string
  nullable: boolean
  default_value: string | null
  is_primary_key: boolean
}

export async function introspectPostgres(
  client: pg.Client,
  target: DatabaseIntrospectTarget,
  serverVersionNum: number
): Promise<DatabaseIntrospectResult> {
  switch (target.level) {
    case 'schemas': {
      const result = await client.query<{ name: string }>(SCHEMAS_SQL)
      return { level: 'schemas', schemas: result.rows.map((row) => ({ name: row.name })) }
    }
    case 'relations': {
      const result = await client.query<{ name: string; kind: string }>(
        relationsSql(serverVersionNum),
        [target.schema]
      )
      return {
        level: 'relations',
        relations: result.rows.map((row) => ({
          name: row.name,
          kind: RELATION_KINDS[row.kind] ?? 'table'
        }))
      }
    }
    case 'columns': {
      const result = await client.query<ColumnRow>(COLUMNS_SQL, [target.schema, target.relation])
      return {
        level: 'columns',
        columns: result.rows.map((row) => ({
          name: row.name,
          dataType: row.data_type,
          nullable: row.nullable,
          defaultValue: row.default_value,
          isPrimaryKey: row.is_primary_key
        }))
      }
    }
  }
}
