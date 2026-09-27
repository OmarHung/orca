import { describe, expect, it } from 'vitest'
import { newConsoleTab, newTableTab, readPersistedTab } from './database-page-tabs'

describe('database page tabs', () => {
  it('round-trips a console’s transaction mode and picked schema', () => {
    const tab = {
      ...newConsoleTab('conn-0001', 'app', 'sales', 'reports'),
      transactionMode: 'manual'
    }
    expect(readPersistedTab(JSON.parse(JSON.stringify(tab)))).toEqual(tab)
  })

  it('reads consoles saved before those fields existed as auto-commit on the default schema', () => {
    const {
      transactionMode: _mode,
      schema: _schema,
      database: _database,
      ...older
    } = newConsoleTab('conn-0001', 'app')
    expect(readPersistedTab(older)).toMatchObject({
      transactionMode: 'auto',
      schema: null,
      database: null
    })
    expect(readPersistedTab({ ...older, schema: '' })).toMatchObject({ schema: null })
  })

  it('round-trips the database a table tab reads from, reading older tabs as the connection’s', () => {
    const tab = newTableTab('conn-0001', 'public', 'items', 'sales')
    expect(readPersistedTab(JSON.parse(JSON.stringify(tab)))).toEqual(tab)
    const { database: _database, ...older } = newTableTab('conn-0001', 'public', 'items')
    expect(readPersistedTab(older)).toMatchObject({ database: null, relation: 'items' })
  })
})
