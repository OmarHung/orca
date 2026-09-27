import { describe, expect, it } from 'vitest'
import { newConsoleTab, newTableTab, readPersistedTab } from './database-page-tabs'

describe('database page tabs', () => {
  it('round-trips a console’s picked schema and database', () => {
    const tab = newConsoleTab('conn-0001', 'app', 'sales', 'reports')
    expect(readPersistedTab(JSON.parse(JSON.stringify(tab)))).toEqual(tab)
  })

  it('reads consoles saved before those fields existed on the default schema', () => {
    const { schema: _schema, database: _database, ...older } = newConsoleTab('conn-0001', 'app')
    expect(readPersistedTab(older)).toMatchObject({ schema: null, database: null })
    expect(readPersistedTab({ ...older, schema: '' })).toMatchObject({ schema: null })
    // Consoles saved with the old transaction mode still load.
    expect(readPersistedTab({ ...older, transactionMode: 'manual' })).not.toHaveProperty(
      'transactionMode'
    )
  })

  it('round-trips the database a table tab reads from, reading older tabs as the connection’s', () => {
    const tab = newTableTab('conn-0001', 'public', 'items', 'sales')
    expect(readPersistedTab(JSON.parse(JSON.stringify(tab)))).toEqual(tab)
    const { database: _database, ...older } = newTableTab('conn-0001', 'public', 'items')
    expect(readPersistedTab(older)).toMatchObject({ database: null, relation: 'items' })
  })
})
