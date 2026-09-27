import { describe, expect, it } from 'vitest'
import {
  changeConnectionDriver,
  initialConnectionForm,
  parseConnectionForm,
  passwordToSave
} from './database-connection-form-state'

describe('database connection form', () => {
  it('defaults to a local PostgreSQL and derives a DataGrip-style name', () => {
    const parsed = parseConnectionForm(initialConnectionForm(null, true))
    expect(parsed).toMatchObject({
      ok: true,
      draft: {
        driver: 'postgres',
        name: 'postgres@localhost',
        port: 5432,
        passwordStorage: 'forever'
      }
    })
  })

  it('falls back to session-only passwords without OS encryption', () => {
    expect(initialConnectionForm(null, false).passwordStorage).toBe('session')
  })

  it('swaps defaults when the driver changes but keeps what the user typed', () => {
    const typed = { ...initialConnectionForm(null, true), host: 'db.local', user: 'app' }
    const mysql = changeConnectionDriver(typed, 'mysql')
    expect(mysql).toMatchObject({ port: '3306', database: '', user: 'app', host: 'db.local' })
    const sqlServer = changeConnectionDriver(mysql, 'sqlserver')
    expect(sqlServer).toMatchObject({ port: '1433', database: 'master', sslMode: 'require' })
  })

  it('builds SQLite drafts from an absolute file path and names them after the file', () => {
    const sqlite = changeConnectionDriver(initialConnectionForm(null, true), 'sqlite')
    expect(parseConnectionForm(sqlite)).toMatchObject({
      ok: false,
      invalidFields: new Set(['filePath'])
    })
    const parsed = parseConnectionForm({ ...sqlite, filePath: '/tmp/app/data.db' })
    expect(parsed).toMatchObject({
      ok: true,
      draft: { driver: 'sqlite', name: 'data.db', filePath: '/tmp/app/data.db' }
    })
    expect(parseConnectionForm({ ...sqlite, filePath: 'relative.db' }).ok).toBe(false)
  })

  it('flags invalid server fields instead of throwing', () => {
    const form = { ...initialConnectionForm(null, true), host: '  ', port: '70000' }
    const parsed = parseConnectionForm(form)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect([...parsed.invalidFields].sort()).toEqual(['host', 'port'])
    }
  })

  it('keeps the saved password unless the field was edited', () => {
    const form = initialConnectionForm(null, true)
    expect(passwordToSave(form)).toBeUndefined()
    expect(passwordToSave({ ...form, password: '', passwordEdited: true })).toBe('')
  })
})
