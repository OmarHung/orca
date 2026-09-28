// How a MySQL/MariaDB dump reads each column's values and writes them back as literals.

const BINARY_TYPES = new Set([
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  'geometrycollection'
])
const NUMERIC_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'bit'
])

export type MysqlValueKind = 'text' | 'number' | 'hex'

export function mysqlTextLiteral(value: string): string {
  // Why backslashes too: MySQL's default sql_mode reads them as escapes inside strings.
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

export function mysqlValueKind(dataType: string): MysqlValueKind {
  const type = dataType.toLowerCase()
  return BINARY_TYPES.has(type) ? 'hex' : NUMERIC_TYPES.has(type) ? 'number' : 'text'
}

/** The SELECT expression that reads a quoted column as text its literal can carry. */
export function mysqlValueSelect(column: string, dataType: string, kind: MysqlValueKind): string {
  return kind === 'hex'
    ? `HEX(${column})`
    : dataType.toLowerCase() === 'bit'
      ? `${column} + 0`
      : column
}

export function mysqlValueLiteral(kind: MysqlValueKind | undefined, value: unknown): string {
  if (typeof value !== 'string') {
    return 'NULL'
  }
  return kind === 'hex' ? `X'${value}'` : kind === 'number' ? value : mysqlTextLiteral(value)
}
