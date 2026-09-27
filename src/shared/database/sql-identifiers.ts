import type { DatabaseDriver } from './database-connection-types'
import { isSqlReservedWord } from './sql-reserved-words'

// Names that need no quoting: PostgreSQL folds unquoted names to lower case, so only those.
const PLAIN_NAME: Record<DatabaseDriver, RegExp> = {
  postgres: /^[a-z_][a-z0-9_$]*$/,
  mysql: /^[A-Za-z_][A-Za-z0-9_$]*$/,
  sqlserver: /^[A-Za-z_][A-Za-z0-9_]*$/,
  sqlite: /^[A-Za-z_][A-Za-z0-9_]*$/
}

/** Quotes an identifier in the dialect's own style, and only when it needs it. */
export function quoteSqlName(name: string, driver: DatabaseDriver): string {
  if (PLAIN_NAME[driver].test(name) && !isSqlReservedWord(name, driver)) {
    return name
  }
  switch (driver) {
    case 'mysql':
      return `\`${name.replaceAll('`', '``')}\``
    case 'sqlserver':
      return `[${name.replaceAll(']', ']]')}]`
    case 'postgres':
    case 'sqlite':
      return `"${name.replaceAll('"', '""')}"`
  }
}

export function qualifiedRelationName(
  schema: string,
  relation: string,
  driver: DatabaseDriver = 'postgres'
): string {
  // SQLite's main database needs no prefix.
  if (driver === 'sqlite' && schema === 'main') {
    return quoteSqlName(relation, driver)
  }
  return `${quoteSqlName(schema, driver)}.${quoteSqlName(relation, driver)}`
}
