import type { DatabaseError } from '../../../shared/database/database-query-types'

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/
// PostgreSQL 57014 query_canceled, MySQL ER_QUERY_INTERRUPTED, tedious attention ack.
const CANCELLED_CODES = new Set(['57014', 'ER_QUERY_INTERRUPTED', 'ECANCEL'])
const MYSQL_LINE = /\bat line (\d+)\b/
/** SQL Server's "Login failed for user", which follows every refused login, e.g. 4060's too. */
export const SQLSERVER_LOGIN_FAILED = 18456

function readString(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readPositiveInteger(source: object, key: string): number | undefined {
  const raw: unknown = Reflect.get(source, key)
  const value = typeof raw === 'string' ? Number(raw) : raw
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
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

/** Normalizes driver errors (pg, mysql2, tedious, node:sqlite, sockets) into the wire shape. */
export function toDatabaseError(error: unknown): DatabaseError {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) }
  }
  const message = readString(error, 'message') ?? 'Unknown database error'
  const sqlState = serverCode(error)
  const cancelled =
    (sqlState !== undefined && CANCELLED_CODES.has(sqlState)) ||
    CANCELLED_CODES.has(readString(error, 'code') ?? '')
  // tedious' ELOGIN: a refused login, which a (new) password may fix unless the server gave
  // another reason, such as 4060 "Cannot open database".
  const number = readPositiveInteger(error, 'number')
  const loginRejected =
    readString(error, 'code') === 'ELOGIN' &&
    (number === undefined || number === SQLSERVER_LOGIN_FAILED)
  const position = readPositiveInteger(error, 'position')
  const line = readPositiveInteger(error, 'lineNumber') ?? Number(MYSQL_LINE.exec(message)?.[1])
  const detail = readString(error, 'detail')
  const hint = readString(error, 'hint')
  return {
    message,
    ...(sqlState ? { sqlState } : {}),
    ...(cancelled ? { code: 'cancelled' as const } : {}),
    ...(loginRejected ? { code: 'password-required' as const } : {}),
    ...(position ? { position } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(detail ? { detail } : {}),
    ...(hint ? { hint } : {})
  }
}
