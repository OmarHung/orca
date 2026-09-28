import type { DatabaseCell } from '../../../shared/database/database-query-types'
import { cellText } from './database-cell-encoding'

/** The subset of tedious column metadata these helpers read. */
export type SqlServerColumnMeta = {
  colName: string
  type: { name: string }
  precision?: number | undefined
  scale?: number | undefined
  dataLength?: number | undefined
}

const MAX_LENGTH = 0xffff
const INT_BY_LENGTH: Record<number, string> = { 1: 'tinyint', 2: 'smallint', 4: 'int', 8: 'bigint' }

function lengthSuffix(meta: SqlServerColumnMeta, bytesPerChar: number): string {
  const length = meta.dataLength
  if (length === undefined) {
    return ''
  }
  return length === MAX_LENGTH || length < 0 ? '(max)' : `(${length / bytesPerChar})`
}

/** SQL Server type names as written in DDL, from tedious' wire types (IntN → int, …). */
export function sqlServerTypeName(meta: SqlServerColumnMeta): string {
  const name = meta.type.name
  switch (name) {
    case 'IntN':
      return INT_BY_LENGTH[meta.dataLength ?? 4] ?? 'int'
    case 'BitN':
      return 'bit'
    case 'FloatN':
      return meta.dataLength === 4 ? 'real' : 'float'
    case 'MoneyN':
      return meta.dataLength === 4 ? 'smallmoney' : 'money'
    case 'DateTimeN':
      return meta.dataLength === 4 ? 'smalldatetime' : 'datetime'
    case 'DecimalN':
    case 'NumericN':
    case 'Decimal':
    case 'Numeric':
      return `${name.replace(/N$/, '').toLowerCase()}(${meta.precision ?? 18},${meta.scale ?? 0})`
    case 'NVarChar':
    case 'NChar':
      return `${name.toLowerCase()}${lengthSuffix(meta, 2)}`
    case 'VarChar':
    case 'Char':
    case 'VarBinary':
    case 'Binary':
      return `${name.toLowerCase()}${lengthSuffix(meta, 1)}`
    case 'Time':
    case 'DateTime2':
    case 'DateTimeOffset':
      return meta.scale === undefined ? name.toLowerCase() : `${name.toLowerCase()}(${meta.scale})`
    default:
      return name.toLowerCase()
  }
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

function formatDate(value: Date, typeName: string): string {
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`
  switch (typeName) {
    case 'Date':
      return date
    case 'Time':
      return time
    case 'DateTimeOffset':
      return value.toISOString()
    default:
      return `${date} ${time}`
  }
}

/** Text form of a tedious value, shaped like SSMS shows it. */
export function encodeSqlServerValue(value: unknown, meta: SqlServerColumnMeta): DatabaseCell {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value instanceof Date) {
    return formatDate(value, meta.type.name)
  }
  if (Buffer.isBuffer(value)) {
    return cellText(`0x${value.toString('hex').toUpperCase()}`)
  }
  if (typeof value === 'object') {
    return cellText(JSON.stringify(value))
  }
  return cellText(value)
}
