import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { SshHostGroup, SshHostGroupsData } from './ssh-host-groups'
import { resolveSshHostDrop, type SshHostDragItem } from './ssh-host-drop-target'
import { UNGROUPED_ROW_KEY, type SshHostTreeRow } from './ssh-host-tree'

const groups: SshHostGroup[] = [
  { id: 'clients', name: 'Clients', parentId: null },
  { id: 'acme', name: 'Acme', parentId: 'clients' },
  { id: 'internal', name: 'Internal', parentId: null }
]
const data: SshHostGroupsData = { groups, hostGroups: { web: 'acme' }, collapsed: [] }

function groupRow(id: string): SshHostTreeRow {
  const group = groups.find((entry) => entry.id === id)!
  return { kind: 'group', key: `g:${id}`, group, depth: 0, hostCount: 0, expanded: true }
}

function hostRow(id: string, groupId: string | null): SshHostTreeRow {
  const target: SshTarget = { id, label: id, host: '192.0.2.1', port: 22, username: 'u' }
  return { kind: 'host', key: `h:${id}`, target, depth: 1, groupId }
}

const ungroupedRow: SshHostTreeRow = {
  kind: 'ungrouped',
  key: UNGROUPED_ROW_KEY,
  hostCount: 0,
  expanded: true
}

function resolve(item: SshHostDragItem, row: SshHostTreeRow | null, offsetRatio = 0.5) {
  return resolveSshHostDrop({ data, item, row, offsetRatio, rootKey: UNGROUPED_ROW_KEY })
}

const web: SshHostDragItem = { kind: 'host', targetId: 'web', groupId: 'acme' }
const internal: SshHostDragItem = { kind: 'group', groupId: 'internal' }

describe('resolveSshHostDrop', () => {
  it('files a host into the group under the pointer, or a host row’s group', () => {
    expect(resolve(web, groupRow('internal'))).toEqual({
      placement: { kind: 'inside', groupId: 'internal' },
      indicatorKey: 'g:internal',
      indicator: 'inside'
    })
    expect(resolve(web, hostRow('ci', 'clients'))?.placement).toEqual({
      kind: 'inside',
      groupId: 'clients'
    })
  })

  it('takes a host out of its group on the ungrouped heading or off the rows', () => {
    const out = {
      placement: { kind: 'inside', groupId: null },
      indicatorKey: UNGROUPED_ROW_KEY,
      indicator: 'inside'
    }
    expect(resolve(web, ungroupedRow)).toEqual(out)
    expect(resolve(web, null)).toEqual(out)
  })

  it('ignores a host dropped where it already is', () => {
    expect(resolve(web, groupRow('acme'))).toBeNull()
    expect(resolve(web, hostRow('api', 'acme'))).toBeNull()
  })

  it('reorders a group on a row’s edges and nests it in the middle', () => {
    expect(resolve(internal, groupRow('clients'), 0.1)).toEqual({
      placement: { kind: 'before', groupId: 'clients' },
      indicatorKey: 'g:clients',
      indicator: 'before'
    })
    expect(resolve(internal, groupRow('clients'), 0.9)?.indicator).toBe('after')
    expect(resolve(internal, groupRow('acme'), 0.5)?.placement).toEqual({
      kind: 'inside',
      groupId: 'acme'
    })
  })

  it('refuses to drop a group into itself or its subgroups', () => {
    const clients: SshHostDragItem = { kind: 'group', groupId: 'clients' }
    expect(resolve(clients, groupRow('acme'), 0.5)).toBeNull()
    expect(resolve(clients, groupRow('clients'), 0.1)).toBeNull()
    expect(resolve(clients, hostRow('web', 'acme'))).toBeNull()
  })

  it('lifts a nested group to the top level off the rows, but not one already there', () => {
    const acme: SshHostDragItem = { kind: 'group', groupId: 'acme' }
    expect(resolve(acme, null)?.placement).toEqual({ kind: 'inside', groupId: null })
    expect(resolve(internal, null)).toBeNull()
    expect(resolve(acme, groupRow('clients'), 0.5)).toBeNull()
  })
})
