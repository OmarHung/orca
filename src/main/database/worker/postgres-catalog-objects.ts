import type pg from 'pg'
import type {
  DatabaseIndexInfo,
  DatabaseKeyInfo,
  DatabaseRoutineInfo
} from '../../../shared/database/database-introspection-types'

const POSTGRES_11 = 110_000

// Why skip extension members: pgcrypto & co. would bury the schema's own routines.
function routinesSql(serverVersionNum: number): string {
  // prokind arrived in PG 11 (with procedures); older servers flag aggregates and windows.
  const kind =
    serverVersionNum >= POSTGRES_11
      ? "case when p.prokind = 'p' then 'procedure' else 'function' end"
      : "'function'"
  const routinesOnly =
    serverVersionNum >= POSTGRES_11
      ? "p.prokind in ('f', 'p')"
      : 'not p.proisagg and not p.proiswindow'
  return `
    select p.oid::pg_catalog.regprocedure::text as identity, p.proname as name, ${kind} as kind,
           pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = $1 and ${routinesOnly}
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid
          and d.deptype = 'e'
      )
    order by p.proname, 1`
}

const KEYS_SQL = `
  select c.conname as name, c.contype as type,
         array(
           select a.attname::text from unnest(c.conkey) with ordinality as k(num, ord)
           join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num
           order by k.ord
         ) as columns,
         rn.nspname::text as ref_schema, rc.relname::text as ref_relation,
         array(
           select a.attname::text from unnest(c.confkey) with ordinality as k(num, ord)
           join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.num
           order by k.ord
         ) as ref_columns
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t on t.oid = c.conrelid
  join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
  left join pg_catalog.pg_class rc on rc.oid = c.confrelid
  left join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
  where tn.nspname = $1 and t.relname = $2 and c.contype in ('p', 'u', 'f')
  order by case c.contype when 'p' then 0 when 'u' then 1 else 2 end, c.conname`

function indexesSql(serverVersionNum: number): string {
  // Key columns only: INCLUDE columns (PG 11) aren't part of what the index sorts by.
  const keyCount = serverVersionNum >= POSTGRES_11 ? 'x.indnkeyatts' : 'x.indnatts'
  return `
    select i.relname as name, x.indisunique as unique, x.indisprimary as primary,
           array(
             select pg_catalog.pg_get_indexdef(x.indexrelid, k.n, true)
             from generate_series(1, ${keyCount}) as k(n) order by k.n
           ) as columns
    from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    join pg_catalog.pg_class t on t.oid = x.indrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = $1 and t.relname = $2
    order by x.indisprimary desc, i.relname`
}

const KEY_KINDS: Record<string, DatabaseKeyInfo['kind']> = {
  p: 'primary',
  u: 'unique',
  f: 'foreign'
}

type KeyRow = {
  name: string
  type: string
  columns: string[]
  ref_schema: string | null
  ref_relation: string | null
  ref_columns: string[] | null
}

export async function postgresRoutines(
  client: pg.Client,
  schema: string,
  serverVersionNum: number
): Promise<DatabaseRoutineInfo[]> {
  const result = await client.query<{
    identity: string
    name: string
    kind: DatabaseRoutineInfo['kind']
    arguments: string
  }>(routinesSql(serverVersionNum), [schema])
  return result.rows.map((row) => ({
    name: row.name,
    kind: row.kind === 'procedure' ? 'procedure' : 'function',
    identity: row.identity,
    arguments: row.arguments
  }))
}

export async function postgresKeys(
  client: pg.Client,
  schema: string,
  relation: string
): Promise<DatabaseKeyInfo[]> {
  const result = await client.query<KeyRow>(KEYS_SQL, [schema, relation])
  return result.rows.map((row) => ({
    name: row.name,
    kind: KEY_KINDS[row.type] ?? 'unique',
    columns: row.columns,
    references:
      row.ref_schema && row.ref_relation
        ? { schema: row.ref_schema, relation: row.ref_relation, columns: row.ref_columns ?? [] }
        : null
  }))
}

export async function postgresIndexes(
  client: pg.Client,
  schema: string,
  relation: string,
  serverVersionNum: number
): Promise<DatabaseIndexInfo[]> {
  const result = await client.query<{
    name: string
    unique: boolean
    primary: boolean
    columns: string[]
  }>(indexesSql(serverVersionNum), [schema, relation])
  return result.rows.map((row) => ({
    name: row.name,
    columns: row.columns,
    unique: row.unique,
    primary: row.primary
  }))
}
