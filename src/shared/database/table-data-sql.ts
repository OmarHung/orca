import { isSqlDriver, type DatabaseDriver } from './database-connection-types'
import { quoteRedisWord } from './redis-command-text'
import { REDIS_VIEW_COMMAND } from './redis-read-only-commands'
import { qualifiedRelationName, quoteSqlName } from './sql-identifiers'

type TableTarget = { driver: DatabaseDriver; schema: string; relation: string }

// Why one fragment per line: a `-- comment` at the end of the filter must not
// comment out the ORDER BY that follows it.
function withFilter(sql: string, where: string): string {
  return where.trim() ? `${sql}\nwhere ${where.trim()}` : sql
}

/** A filter or sort typed with or without its braces, as one shell document. */
function shellDocument(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return '{}'
  }
  return trimmed.startsWith('{') ? trimmed : `{ ${trimmed} }`
}

function mongoCollection(relation: string): string {
  return `db.getCollection(${JSON.stringify(relation)})`
}

/**
 * DataGrip-style table data query: the user's WHERE and ORDER BY are raw SQL fragments. For
 * MongoDB they are a filter and a sort document; a Redis key shows its whole value.
 */
export function buildTableDataSql(
  target: TableTarget & { where: string; orderBy: string }
): string {
  const { driver } = target
  if (driver === 'redis') {
    return `${REDIS_VIEW_COMMAND} ${quoteRedisWord(target.relation)}`
  }
  if (driver === 'mongodb') {
    const sort = target.orderBy.trim() ? `.sort(${shellDocument(target.orderBy)})` : ''
    return `${mongoCollection(target.relation)}.find(${shellDocument(target.where)})${sort}`
  }
  const table = qualifiedRelationName(target.schema, target.relation, driver)
  const filtered = withFilter(`select * from ${table}`, target.where)
  return target.orderBy.trim() ? `${filtered}\norder by ${target.orderBy.trim()}` : filtered
}

/** The count for the table's filter, or null where there is none to run (a Redis key). */
export function buildTableCountSql(target: TableTarget & { where: string }): string | null {
  const { driver } = target
  if (driver === 'redis') {
    return null
  }
  if (driver === 'mongodb') {
    return `${mongoCollection(target.relation)}.countDocuments(${shellDocument(target.where)})`
  }
  const table = qualifiedRelationName(target.schema, target.relation, driver)
  return withFilter(`select count(*) from ${table}`, target.where)
}

/** The ORDER BY (or MongoDB sort) for a header click; empty where the server can't sort. */
export function orderByForSort(
  column: string,
  direction: 'asc' | 'desc',
  driver: DatabaseDriver
): string {
  if (driver === 'mongodb') {
    return `{ ${JSON.stringify(column)}: ${direction === 'asc' ? 1 : -1} }`
  }
  return isSqlDriver(driver) ? `${quoteSqlName(column, driver)} ${direction}` : ''
}

/** How Copy Qualified Name writes a table, collection or key. */
export function qualifiedObjectName(
  schema: string,
  relation: string,
  driver: DatabaseDriver | undefined
): string {
  if (driver === 'redis') {
    return relation
  }
  if (driver === 'mongodb') {
    return `${schema}.${relation}`
  }
  return qualifiedRelationName(schema, relation, driver)
}
