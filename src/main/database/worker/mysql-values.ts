import type { FieldPacket } from 'mysql2'
import type { DatabaseCell, DatabaseColumn } from '../../../shared/database/database-query-types'
import { encodeTextCell } from './database-cell-encoding'

const BINARY_CHARSET = 63
const UNSIGNED_FLAG = 32
const BIT_TYPE = 16

// MySQL protocol column type codes → the names users see in DDL.
const TYPE_NAMES: Record<number, string> = {
  0: 'decimal',
  1: 'tinyint',
  2: 'smallint',
  3: 'int',
  4: 'float',
  5: 'double',
  6: 'null',
  7: 'timestamp',
  8: 'bigint',
  9: 'mediumint',
  10: 'date',
  11: 'time',
  12: 'datetime',
  13: 'year',
  14: 'date',
  15: 'varchar',
  16: 'bit',
  245: 'json',
  246: 'decimal',
  247: 'enum',
  248: 'set',
  249: 'tinytext',
  250: 'mediumtext',
  251: 'longtext',
  252: 'text',
  253: 'varchar',
  254: 'char',
  255: 'geometry'
}

const BINARY_NAMES: Record<string, string> = {
  varchar: 'varbinary',
  char: 'binary',
  tinytext: 'tinyblob',
  mediumtext: 'mediumblob',
  longtext: 'longblob',
  text: 'blob'
}

const INTEGER_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint'])

function hasUnsignedFlag(flags: FieldPacket['flags']): boolean {
  return typeof flags === 'number' ? (flags & UNSIGNED_FLAG) !== 0 : flags.includes('UNSIGNED')
}

export function mysqlColumnType(field: FieldPacket): string {
  const code = field.columnType ?? field.type ?? -1
  const base = TYPE_NAMES[code] ?? field.typeName?.toLowerCase() ?? 'unknown'
  const name = field.characterSet === BINARY_CHARSET ? (BINARY_NAMES[base] ?? base) : base
  return INTEGER_TYPES.has(name) && hasUnsignedFlag(field.flags) ? `${name} unsigned` : name
}

export function mysqlColumns(fields: readonly FieldPacket[]): DatabaseColumn[] {
  return fields.map((field) => ({ name: field.name, typeName: mysqlColumnType(field) }))
}

function encodeBuffer(value: Buffer, field: FieldPacket | undefined): string {
  const code = field?.columnType ?? field?.type
  if (code === BIT_TYPE) {
    // BIT(n) reads as big-endian bytes; show the number like the mysql client does.
    return value.reduce((total, byte) => (total << 8n) | BigInt(byte), 0n).toString()
  }
  return `0x${value.toString('hex')}`
}

/** Values arrive as strings (dateStrings, bigNumberStrings, jsonStrings) except binary and numbers. */
export function encodeMysqlRow(row: unknown[], fields: readonly FieldPacket[]): DatabaseCell[] {
  return row.map((value, index) => {
    if (Buffer.isBuffer(value)) {
      return encodeTextCell(encodeBuffer(value, fields[index]))
    }
    if (typeof value === 'object' && value !== null) {
      return encodeTextCell(JSON.stringify(value))
    }
    return encodeTextCell(value)
  })
}
