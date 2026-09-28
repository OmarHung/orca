import { describe, expect, it } from 'vitest'
import {
  databaseConnectionGroupNames,
  groupDatabaseConnections,
  normalizeDatabaseConnectionGroup
} from './database-connection-groups'

describe('database connection groups', () => {
  const connections = [
    { id: 'a', group: 'Staging' },
    { id: 'b' },
    { id: 'c', group: 'clients' },
    { id: 'd', group: 'Staging' },
    { id: 'e', group: null }
  ]

  it('names each group once, sorted without regard to case', () => {
    expect(databaseConnectionGroupNames(connections)).toEqual(['clients', 'Staging'])
  })

  it('keeps saved order inside groups and among ungrouped connections', () => {
    expect(groupDatabaseConnections(connections)).toEqual({
      groups: [
        { name: 'clients', connectionIds: ['c'] },
        { name: 'Staging', connectionIds: ['a', 'd'] }
      ],
      ungrouped: ['b', 'e']
    })
  })

  it('saves a blank group name as no group', () => {
    expect(normalizeDatabaseConnectionGroup('  prod  ')).toBe('prod')
    expect(normalizeDatabaseConnectionGroup('   ')).toBeNull()
  })
})
