import { describe, expect, it } from 'vitest'
import {
  initialConnectionForm,
  parseConnectionForm,
  passwordToSave
} from './database-connection-form-state'

describe('database connection form', () => {
  it('defaults to a local PostgreSQL and derives a DataGrip-style name', () => {
    const form = initialConnectionForm(null, true)
    const parsed = parseConnectionForm(form)
    expect(parsed).toMatchObject({
      ok: true,
      draft: {
        name: 'postgres@localhost',
        host: 'localhost',
        port: 5432,
        passwordStorage: 'forever'
      }
    })
  })

  it('falls back to session-only passwords without OS encryption', () => {
    expect(initialConnectionForm(null, false).passwordStorage).toBe('session')
  })

  it('flags invalid fields instead of throwing', () => {
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
