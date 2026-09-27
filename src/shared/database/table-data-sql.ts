import type { DatabaseDriver } from './database-connection-types'
import { qualifiedRelationName, quoteSqlName } from './sql-identifiers'

type TableTarget = { driver: DatabaseDriver; schema: string; relation: string }

// Why one fragment per line: a `-- comment` at the end of the filter must not
// comment out the ORDER BY that follows it.
function withFilter(sql: string, where: string): string {
  return where.trim() ? `${sql}\nwhere ${where.trim()}` : sql
}

/** DataGrip-style table data query: the user's WHERE and ORDER BY are raw SQL fragments. */
export function buildTableDataSql(
  target: TableTarget & { where: string; orderBy: string }
): string {
  const table = qualifiedRelationName(target.schema, target.relation, target.driver)
  const filtered = withFilter(`select * from ${table}`, target.where)
  return target.orderBy.trim() ? `${filtered}\norder by ${target.orderBy.trim()}` : filtered
}

export function buildTableCountSql(target: TableTarget & { where: string }): string {
  const table = qualifiedRelationName(target.schema, target.relation, target.driver)
  return withFilter(`select count(*) from ${table}`, target.where)
}

export function orderByForSort(
  column: string,
  direction: 'asc' | 'desc',
  driver: DatabaseDriver
): string {
  return `${quoteSqlName(column, driver)} ${direction}`
}
