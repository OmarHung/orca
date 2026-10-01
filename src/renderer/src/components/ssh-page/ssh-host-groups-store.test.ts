// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_SSH_HOST_GROUPS } from './ssh-host-groups'
import { parseSshHostGroupsData } from './ssh-host-groups-store'

const STORAGE_KEY = 'orca.sshHostGroups'

describe('parseSshHostGroupsData', () => {
  it('keeps well-formed data as stored', () => {
    const data = {
      groups: [
        { id: 'a', name: 'A', parentId: null },
        { id: 'b', name: 'B', parentId: 'a' }
      ],
      hostGroups: { web: 'b' },
      collapsed: ['a']
    }
    expect(parseSshHostGroupsData(data)).toEqual(data)
  })

  it('drops malformed entries and hosts filed under unknown groups', () => {
    expect(
      parseSshHostGroupsData({
        groups: [
          { id: 'a', name: '  A  ' },
          { id: 'a', name: 'duplicate id' },
          { id: 'blank', name: '   ' },
          { name: 'no id' },
          'not a group'
        ],
        hostGroups: { web: 'a', api: 'missing', ci: 7 },
        collapsed: ['a', 3]
      })
    ).toEqual({
      groups: [{ id: 'a', name: 'A', parentId: null }],
      hostGroups: { web: 'a' },
      collapsed: ['a']
    })
    expect(parseSshHostGroupsData('nonsense')).toEqual(EMPTY_SSH_HOST_GROUPS)
  })

  it('lifts groups with a missing parent or a parent cycle to the top level', () => {
    const parsed = parseSshHostGroupsData({
      groups: [
        { id: 'x', name: 'X', parentId: 'y' },
        { id: 'y', name: 'Y', parentId: 'x' },
        { id: 'child', name: 'Child', parentId: 'x' },
        { id: 'orphan', name: 'Orphan', parentId: 'gone' }
      ]
    })
    expect(parsed.groups.map((group) => [group.id, group.parentId])).toEqual([
      ['x', null],
      ['y', null],
      ['child', 'x'],
      ['orphan', null]
    ])
  })
})

describe('useSshHostGroups', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('creates a group with its hosts and keeps it across reloads', async () => {
    const { sshHostGroupActions, useSshHostGroups } = await import('./ssh-host-groups-store')
    sshHostGroupActions.create('Prod', null, ['web'])
    const [group] = useSshHostGroups.getState().data.groups
    expect(group?.name).toBe('Prod')
    expect(useSshHostGroups.getState().data.hostGroups).toEqual({ web: group?.id })

    vi.resetModules()
    const reloaded = await import('./ssh-host-groups-store')
    expect(reloaded.useSshHostGroups.getState().data).toEqual(useSshHostGroups.getState().data)
  })

  it('starts without groups when storage holds corrupt JSON', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const { useSshHostGroups } = await import('./ssh-host-groups-store')
    expect(useSshHostGroups.getState().data).toEqual(EMPTY_SSH_HOST_GROUPS)
  })
})
