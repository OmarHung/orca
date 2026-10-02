import { describe, expect, it } from 'vitest'
import {
  databaseConnectionGroupNames,
  groupDatabaseConnections,
  groupSessionState,
  normalizeDatabaseConnectionGroup
} from './database-connection-groups'

describe('database connection groups', () => {
  const connections = [
    { id: 'a', group: 'Staging' },
    { id: 'b' },
    { id: 'c', group: 'auzcare' },
    { id: 'd', group: 'Staging' },
    { id: 'e', group: null }
  ]

  it('names each group once, sorted without regard to case', () => {
    expect(databaseConnectionGroupNames(connections)).toEqual(['auzcare', 'Staging'])
  })

  it('keeps saved order inside groups and among ungrouped connections', () => {
    expect(groupDatabaseConnections(connections)).toEqual({
      groups: [
        { name: 'auzcare', connectionIds: ['c'] },
        { name: 'Staging', connectionIds: ['a', 'd'] }
      ],
      ungrouped: ['b', 'e']
    })
  })

  it('saves a blank group name as no group', () => {
    expect(normalizeDatabaseConnectionGroup('  prod  ')).toBe('prod')
    expect(normalizeDatabaseConnectionGroup('   ')).toBeNull()
  })

  it('marks a group connected when any connection in it is, ahead of one still connecting', () => {
    expect(groupSessionState(['error', 'connecting', 'connected', undefined])).toBe('connected')
    expect(groupSessionState(['disconnected', 'connecting'])).toBe('connecting')
  })

  it('leaves a group unmarked when nothing in it is connected or connecting', () => {
    expect(groupSessionState(['error', 'disconnected', undefined])).toBe('disconnected')
    expect(groupSessionState([])).toBe('disconnected')
  })
})
