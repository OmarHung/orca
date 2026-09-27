import type pg from 'pg'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import { qualifiedRelationName, quoteSqlName } from '../../../shared/database/sql-identifiers'

const POSTGRES_10 = 100_000
const POSTGRES_12 = 120_000

const RELATION_SQL = `
  select c.oid, c.relkind
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and c.relname = $2`

function columnsSql(serverVersionNum: number): string {
  // Identity columns arrived in PG 10, stored generated columns in PG 12.
  const identity = serverVersionNum >= POSTGRES_10 ? 'a.attidentity' : "''"
  const generated = serverVersionNum >= POSTGRES_12 ? 'a.attgenerated' : "''"
  return `
    select a.attname as name, pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as not_null, pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expr,
           ${identity}::text as identity, ${generated}::text as generated
    from pg_catalog.pg_attribute a
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped
    order by a.attnum`
}

// NOT NULL (PG 18's contype 'n') is already on the column lines.
const CONSTRAINTS_SQL = `
  select conname as name, pg_catalog.pg_get_constraintdef(oid, true) as definition
  from pg_catalog.pg_constraint
  where conrelid = $1::oid and contype in ('p', 'u', 'c', 'x', 'f')
  order by case contype when 'p' then 0 when 'u' then 1 when 'c' then 2 when 'x' then 3 else 4 end,
           conname`

// Indexes that back a constraint are created by it.
const INDEXES_SQL = `
  select pg_catalog.pg_get_indexdef(i.indexrelid) as definition
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  where i.indrelid = $1::oid
    and not exists (select 1 from pg_catalog.pg_constraint k where k.conindid = i.indexrelid)
  order by c.relname`

const FOREIGN_TABLE_SQL = `
  select s.srvname as server,
         (select string_agg(pg_catalog.quote_ident(split_part(o, '=', 1)) || ' '
                            || pg_catalog.quote_literal(substr(o, strpos(o, '=') + 1)), ', ')
          from unnest(t.ftoptions) as o) as options
  from pg_catalog.pg_foreign_table t
  join pg_catalog.pg_foreign_server s on s.oid = t.ftserver
  where t.ftrelid = $1::oid`

type ColumnRow = {
  name: string
  type: string
  not_null: boolean
  default_expr: string | null
  identity: string
  generated: string
}

function columnLine(row: ColumnRow): string {
  const parts = [quoteSqlName(row.name, 'postgres'), row.type]
  if (row.identity === 'a' || row.identity === 'd') {
    parts.push(`GENERATED ${row.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`)
  } else if (row.generated === 's' && row.default_expr) {
    parts.push(`GENERATED ALWAYS AS (${row.default_expr}) STORED`)
  } else if (row.default_expr) {
    parts.push(`DEFAULT ${row.default_expr}`)
  }
  if (row.not_null && row.identity !== 'a' && row.identity !== 'd') {
    parts.push('NOT NULL')
  }
  return parts.join(' ')
}

function withSemicolon(sql: string): string {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

async function tableDdl(
  client: pg.Client,
  oid: number,
  relkind: string,
  name: string,
  serverVersionNum: number
): Promise<string> {
  // One after another: a pg client runs one query at a time anyway, and pg@9 refuses overlap.
  const columns = await client.query<ColumnRow>(columnsSql(serverVersionNum), [oid])
  const constraints = await client.query<{ name: string; definition: string }>(CONSTRAINTS_SQL, [
    oid
  ])
  const indexes = await client.query<{ definition: string }>(INDEXES_SQL, [oid])
  const lines = [
    ...columns.rows.map(columnLine),
    ...constraints.rows.map(
      (row) => `CONSTRAINT ${quoteSqlName(row.name, 'postgres')} ${row.definition}`
    )
  ]
  let suffix = ''
  if (relkind === 'p') {
    const key = await client.query<{ key: string }>(
      'select pg_catalog.pg_get_partkeydef($1::oid) as key',
      [oid]
    )
    suffix = ` PARTITION BY ${key.rows[0]?.key ?? ''}`
  } else if (relkind === 'f') {
    const foreign = await client.query<{ server: string; options: string | null }>(
      FOREIGN_TABLE_SQL,
      [oid]
    )
    const row = foreign.rows[0]
    suffix = row
      ? ` SERVER ${quoteSqlName(row.server, 'postgres')}${row.options ? ` OPTIONS (${row.options})` : ''}`
      : ''
  }
  const create = relkind === 'f' ? 'CREATE FOREIGN TABLE' : 'CREATE TABLE'
  const table = `${create} ${name} (\n${lines.map((line) => `    ${line}`).join(',\n')}\n)${suffix};`
  return [table, ...indexes.rows.map((row) => withSemicolon(row.definition))].join('\n\n')
}

export async function postgresDdl(
  client: pg.Client,
  target: DatabaseDdlTarget,
  serverVersionNum: number
): Promise<string> {
  if (target.kind === 'routine') {
    const result = await client.query<{ definition: string }>(
      'select pg_catalog.pg_get_functiondef($1::pg_catalog.regprocedure) as definition',
      [target.identity]
    )
    return result.rows[0]?.definition.trim() ?? ''
  }
  const relation = await client.query<{ oid: number; relkind: string }>(RELATION_SQL, [
    target.schema,
    target.relation
  ])
  const row = relation.rows[0]
  if (!row) {
    throw new Error(`${target.schema}.${target.relation} no longer exists.`)
  }
  const name = qualifiedRelationName(target.schema, target.relation, 'postgres')
  if (row.relkind === 'v' || row.relkind === 'm') {
    const view = await client.query<{ definition: string }>(
      'select pg_catalog.pg_get_viewdef($1::oid, true) as definition',
      [row.oid]
    )
    const create = row.relkind === 'm' ? 'CREATE MATERIALIZED VIEW' : 'CREATE OR REPLACE VIEW'
    const body = withSemicolon(`${create} ${name} AS\n${view.rows[0]?.definition ?? ''}`)
    if (row.relkind === 'v') {
      return body
    }
    const indexes = await client.query<{ definition: string }>(INDEXES_SQL, [row.oid])
    return [body, ...indexes.rows.map((index) => withSemicolon(index.definition))].join('\n\n')
  }
  return tableDdl(client, row.oid, row.relkind, name, serverVersionNum)
}
