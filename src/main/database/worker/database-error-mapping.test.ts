import { describe, expect, it } from 'vitest'
import { toDatabaseError } from './database-error-mapping'
import { SqlServerLoginError } from './sqlserver-client-factory'

describe('toDatabaseError', () => {
  it('marks a login SQL Server refused as needing a password', () => {
    // tedious' own ConnectionError carries only ELOGIN and the last message.
    expect(
      toDatabaseError(Object.assign(new Error("Login failed for user 'sa'."), { code: 'ELOGIN' }))
    ).toEqual({ message: "Login failed for user 'sa'.", code: 'password-required' })
    // connectSqlServer's, with every reason the server gave and its 18456.
    expect(
      toDatabaseError(
        new SqlServerLoginError(
          'Cannot open database "sales" requested by the login. The login failed. Login failed for user \'sa\'.',
          18456
        )
      )
    ).toEqual({
      message:
        'Cannot open database "sales" requested by the login. The login failed. Login failed for user \'sa\'.',
      sqlState: '18456',
      code: 'password-required'
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
