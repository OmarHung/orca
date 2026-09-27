import type { SqlDialect } from '../../../../../shared/database/sql-dialect-lexing'

const COMMON_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'AS',
  'ON',
  'USING',
  'DISTINCT',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'ASC',
  'DESC',
  'UNION',
  'UNION ALL',
  'EXCEPT',
  'INTERSECT',
  'WITH',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'VALUES',
  'SET',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'CAST'
]

// Reads only: Orca's database tools don't run statements that change anything.
const DIALECT_KEYWORDS: Record<SqlDialect, readonly string[]> = {
  postgres: ['LIMIT', 'OFFSET', 'ILIKE', 'EXPLAIN ANALYZE'],
  mysql: ['LIMIT', 'OFFSET', 'SHOW TABLES', 'DESCRIBE', 'EXPLAIN'],
  sqlserver: ['TOP', 'OFFSET', 'FETCH NEXT', 'ROWS ONLY', 'EXEC'],
  sqlite: ['LIMIT', 'OFFSET', 'PRAGMA', 'EXPLAIN QUERY PLAN']
}

export function sqlKeywords(dialect: SqlDialect): readonly string[] {
  return [...COMMON_KEYWORDS, ...DIALECT_KEYWORDS[dialect]]
}
