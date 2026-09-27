import { describe, expect, it } from 'vitest'
import { newConsoleTab, readPersistedTab } from './database-page-tabs'

describe('database page tabs', () => {
  it('round-trips a console’s transaction mode and picked schema', () => {
    const tab = { ...newConsoleTab('conn-0001', 'app', 'sales'), transactionMode: 'manual' }
    expect(readPersistedTab(JSON.parse(JSON.stringify(tab)))).toEqual(tab)
  })

  it('reads consoles saved before those fields existed as auto-commit on the default schema', () => {
    const { transactionMode: _mode, schema: _schema, ...older } = newConsoleTab('conn-0001', 'app')
    expect(readPersistedTab(older)).toMatchObject({ transactionMode: 'auto', schema: null })
    expect(readPersistedTab({ ...older, schema: '' })).toMatchObject({ schema: null })
  })
})
