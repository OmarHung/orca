import type pg from 'pg'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import { postgresTextLiteral } from './dump/postgres-dump-catalog'

// COMMENT ON statements: CREATE can't carry a comment, so Show DDL and dumps add them after it.

const RELATION_KINDS: Record<string, string> = {
  r: 'TABLE',
  p: 'TABLE',
  v: 'VIEW',
  m: 'MATERIALIZED VIEW',
  f: 'FOREIGN TABLE'
}

const RELATION_COMMENTS_SQL = `
  select commented.column_name, commented.comment from (
    select 0 as position, null::text as column_name,
           pg_catalog.obj_description($1::oid, 'pg_class') as comment
    union all
    select a.attnum, a.attname::text, pg_catalog.col_description(a.attrelid, a.attnum)
    from pg_catalog.pg_attribute a
    where a.attrelid = $1::oid and a.attnum > 0 and not a.attisdropped
  ) commented
  where commented.comment is not null
  order by commented.position`

/** `target` is what COMMENT ON names, e.g. `TABLE "s"."t"`; the dump turns on standard strings. */
export function postgresCommentStatement(target: string, comment: string): string {
  return `COMMENT ON ${target} IS ${postgresTextLiteral(comment)};`
}

/** The relation's comment, then each commented column's, in column order. */
export async function postgresRelationComments(
  client: pg.Client,
  relation: { oid: number; relkind: string; name: string }
): Promise<string[]> {
  const result = await client.query<{ column_name: string | null; comment: string }>(
    RELATION_COMMENTS_SQL,
    [relation.oid]
  )
  const kind = RELATION_KINDS[relation.relkind] ?? 'TABLE'
  return result.rows.map((row) =>
    postgresCommentStatement(
      row.column_name === null
        ? `${kind} ${relation.name}`
        : `COLUMN ${relation.name}.${quoteSqlName(row.column_name, 'postgres')}`,
      row.comment
    )
  )
}

/** The routine's comment, when it has one; `identity` is its regprocedure text. */
export async function postgresRoutineComments(
  client: pg.Client,
  routine: { identity: string; routineKind: 'function' | 'procedure' }
): Promise<string[]> {
  const result = await client.query<{ comment: string | null }>(
    "select pg_catalog.obj_description($1::pg_catalog.regprocedure, 'pg_proc') as comment",
    [routine.identity]
  )
  const comment = result.rows[0]?.comment
  const kind = routine.routineKind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
  return comment ? [postgresCommentStatement(`${kind} ${routine.identity}`, comment)] : []
}
