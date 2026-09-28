import { describe, expect, it } from 'vitest'
import { toDatabaseError } from './database-error-mapping'
import { sqlServerLoginFailure } from './sqlserver-client-factory'

const refused = (): Error =>
  Object.assign(new Error("Login failed for user 'sa'."), { code: 'ELOGIN' })
const LOGIN_FAILED = { number: 18456, message: "Login failed for user 'sa'." }
const CANNOT_OPEN = {
  number: 4060,
  message: 'Cannot open database "sales" requested by the login. The login failed.'
}

describe('toDatabaseError', () => {
  it('marks a login SQL Server refused as needing a password', () => {
    // tedious' own ConnectionError carries only ELOGIN and the last message.
    expect(toDatabaseError(refused())).toEqual({
      message: "Login failed for user 'sa'.",
      code: 'password-required'
    })
    // connectSqlServer's, when the server's only reason is 18456.
    expect(toDatabaseError(sqlServerLoginFailure(refused(), [LOGIN_FAILED]))).toEqual({
      message: "Login failed for user 'sa'.",
      sqlState: '18456',
      code: 'password-required'
    })
  })

  it('keeps a database SQL Server could not open as the reason, not a password prompt', () => {
    // A right password with a missing database: 4060 first, then the 18456 every refusal ends in.
    expect(toDatabaseError(sqlServerLoginFailure(refused(), [CANNOT_OPEN, LOGIN_FAILED]))).toEqual({
      message: `${CANNOT_OPEN.message} ${LOGIN_FAILED.message}`,
      sqlState: '4060'
    })
  })

  it('leaves other errors to what they are', () => {
    expect(
      toDatabaseError(Object.assign(new Error("Invalid object name 'people'."), { number: 208 }))
    ).toEqual({ message: "Invalid object name 'people'.", sqlState: '208' })
    expect(
      toDatabaseError(Object.assign(new Error('Failed to connect'), { code: 'ESOCKET' }))
    ).toEqual({ message: 'Failed to connect' })
    expect(
      toDatabaseError(Object.assign(new Error('canceling statement'), { code: '57014' }))
    ).toMatchObject({ code: 'cancelled', sqlState: '57014' })
  })
})
