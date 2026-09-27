import type { DatabaseSync } from 'node:sqlite'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import { quoteSqliteIdentifier } from './sqlite-introspection'

/** SQLite keeps each object's CREATE statement as written: the table or view, then its indexes and triggers. */
export function sqliteDdl(database: DatabaseSync, target: DatabaseDdlTarget): string {
  if (target.kind === 'routine') {
    throw new Error('SQLite has no stored routines.')
  }
  const statements = database
    .prepare(
      `select sql from ${quoteSqliteIdentifier(target.schema)}.sqlite_master
       where tbl_name = ? and sql is not null
       order by case type when 'table' then 0 when 'view' then 0 when 'index' then 1 else 2 end, name`
    )
    .all(target.relation)
    .map((row) => `${String(row.sql).trim()};`)
  if (statements.length === 0) {
    throw new Error(`${target.relation} no longer exists.`)
  }
  return statements.join('\n\n')
}
