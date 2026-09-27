import type { DatabaseError } from '../../../shared/database/database-query-types'

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/
// PostgreSQL 57014 query_canceled, MySQL ER_QUERY_INTERRUPTED, tedious attention ack.
const CANCELLED_CODES = new Set(['57014', 'ER_QUERY_INTERRUPTED', 'ECANCEL'])
const MYSQL_LINE = /\bat line (\d+)\b/

function readString(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readPositiveInteger(source: object, key: string): number | undefined {
  const raw: unknown = Reflect.get(source, key)
  const value = typeof raw === 'string' ? Number(raw) : raw
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function readIndex(source: object, key: string): number | undefined {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/** pg `code`, mysql2 `sqlState`, or the SQL Server error number (e.g. 208). */
function serverCode(error: object): string | undefined {
  const code = readString(error, 'code')
  if (code && SQLSTATE_PATTERN.test(code)) {
    return code
  }
  const sqlState = readString(error, 'sqlState')
  if (sqlState && SQLSTATE_PATTERN.test(sqlState)) {
    return sqlState
  }
  const number = readPositiveInteger(error, 'number')
  return number === undefined ? undefined : String(number)
}

/** An error already in wire shape, for failures that carry more than the driver's error. */
export class DatabaseWireError extends Error {
  constructor(readonly wire: DatabaseError) {
    super(wire.message)
  }
}

/** Normalizes driver errors (pg, mysql2, tedious, node:sqlite, sockets) into the wire shape. */
export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseWireError) {
    return error.wire
  }
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) }
  }
  const message = readString(error, 'message') ?? 'Unknown database error'
  const sqlState = serverCode(error)
  const cancelled =
    (sqlState !== undefined && CANCELLED_CODES.has(sqlState)) ||
    CANCELLED_CODES.has(readString(error, 'code') ?? '')
  const position = readPositiveInteger(error, 'position')
  const line = readPositiveInteger(error, 'lineNumber') ?? Number(MYSQL_LINE.exec(message)?.[1])
  const detail = readString(error, 'detail')
  const hint = readString(error, 'hint')
  const changeIndex = readIndex(error, 'changeIndex')
  return {
    message,
    ...(sqlState ? { sqlState } : {}),
    ...(cancelled ? { code: 'cancelled' as const } : {}),
    ...(position ? { position } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(detail ? { detail } : {}),
    ...(hint ? { hint } : {}),
    ...(changeIndex === undefined ? {} : { changeIndex })
  }
}
