import type { DatabaseError } from '../../../shared/database/database-query-types'

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/
const QUERY_CANCELED_SQLSTATE = '57014'

function readString(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Normalizes driver errors (pg `DatabaseError`, socket errors) into the wire shape. */
export function toDatabaseError(error: unknown): DatabaseError {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) }
  }
  const message = readString(error, 'message') ?? 'Unknown database error'
  const code = readString(error, 'code')
  const sqlState = code && SQLSTATE_PATTERN.test(code) ? code : undefined
  const position = Number(readString(error, 'position'))
  return {
    message,
    ...(sqlState ? { sqlState } : {}),
    ...(sqlState === QUERY_CANCELED_SQLSTATE ? { code: 'cancelled' as const } : {}),
    ...(Number.isInteger(position) && position > 0 ? { position } : {}),
    ...(readString(error, 'detail') ? { detail: readString(error, 'detail') } : {}),
    ...(readString(error, 'hint') ? { hint: readString(error, 'hint') } : {})
  }
}
