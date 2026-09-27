import { quoteSqlName } from '../../../../shared/database/sql-identifiers'

/** How a column's value is read back as text, and written out as a literal. */
export type SqlServerValueKind = 'text' | 'number' | 'float' | 'temporal' | 'hex'

const EXACT_NUMBERS = new Set(['tinyint', 'smallint', 'int', 'bigint', 'bit', 'decimal', 'numeric'])
const MONEY = new Set(['money', 'smallmoney'])
const TEMPORAL = new Set([
  'date',
  'time',
  'datetime',
  'datetime2',
  'smalldatetime',
  'datetimeoffset'
])
const BINARY = new Set(['binary', 'varbinary', 'image'])

export function sqlServerTextLiteral(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`
}

/**
 * A string literal that keeps every backslash. T-SQL drops a backslash that ends a line inside
 * a string (a line continuation), so the string is cut after each such backslash.
 */
export function sqlServerStringLiteral(value: string): string {
  const parts = value.split(/(?<=\\)(?=\r?\n)/)
  if (parts.length === 1) {
    return sqlServerTextLiteral(value)
  }
  // Why nvarchar(max): joining two short literals would otherwise stop at 4000 characters.
  const [first = '', ...rest] = parts
  return [
    `CAST(${sqlServerTextLiteral(first)} AS nvarchar(max))`,
    ...rest.map(sqlServerTextLiteral)
  ].join(' + ')
}

export function sqlServerValueKind(baseType: string, isAssemblyType: boolean): SqlServerValueKind {
  if (isAssemblyType || BINARY.has(baseType)) {
    return 'hex'
  }
  if (EXACT_NUMBERS.has(baseType) || MONEY.has(baseType)) {
    return 'number'
  }
  if (baseType === 'float' || baseType === 'real') {
    return 'float'
  }
  return TEMPORAL.has(baseType) ? 'temporal' : 'text'
}

/** The SELECT expression that reads a column so no value is rounded on its way out. */
export function sqlServerValueSelect(
  column: string,
  baseType: string,
  kind: SqlServerValueKind
): string {
  const name = quoteSqlName(column, 'sqlserver')
  switch (kind) {
    case 'hex':
      return `CONVERT(varchar(max), CAST(${name} AS varbinary(max)), 1)`
    case 'number':
      // Why style 2 for money: the default style keeps only two of its four decimals.
      return MONEY.has(baseType)
        ? `CONVERT(varchar(64), ${name}, 2)`
        : `CAST(${name} AS varchar(64))`
    case 'float':
      return name
    case 'temporal':
      // Why ISO 8601 (126): the only form every DATEFORMAT and language reads the same way.
      return `CONVERT(nvarchar(64), ${name}, 126)`
    case 'text':
      return `CAST(${name} AS nvarchar(max))`
  }
}

export function sqlServerValueLiteral(kind: SqlServerValueKind, value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  switch (kind) {
    case 'hex':
      // Style 1 turns an empty value into '' rather than 0x.
      return String(value) || '0x'
    case 'number':
      return String(value)
    case 'float': {
      // Why an exponent: it makes the literal a float, not a decimal that is then converted.
      const text = String(value)
      return /e/i.test(text) ? text : `${text}E0`
    }
    case 'temporal':
      return sqlServerTextLiteral(String(value))
    case 'text':
      return sqlServerStringLiteral(String(value))
  }
}
