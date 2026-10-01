import { describe, expect, it } from 'vitest'
import {
  addSshHostGroup,
  canMoveSshHostGroup,
  EMPTY_SSH_HOST_GROUPS,
  formatSshHostGroupPath,
  isSshHostGroupNameTaken,
  moveSshHostGroup,
  moveSshHostsToGroup,
  normalizeSshHostGroupName,
  renameSshHostGroup,
  setSshHostGroupCollapsed,
  sshHostGroupIdOf,
  sshHostGroupsInTreeOrder,
  ungroupSshHostGroup,
  type SshHostGroupsData
} from './ssh-host-groups'

// clients ─┬─ acme ── prod
//          └─ globex
// internal
const tree: SshHostGroupsData = {
  groups: [
    { id: 'clients', name: 'Clients', parentId: null },
    { id: 'acme', name: 'Acme', parentId: 'clients' },
    { id: 'internal', name: 'Internal', parentId: null },
    { id: 'prod', name: 'prod', parentId: 'acme' },
    { id: 'globex', name: 'Globex', parentId: 'clients' }
  ],
  hostGroups: { web: 'prod', ci: 'internal', db: 'acme' },
  collapsed: []
}

function order(data: SshHostGroupsData): string[] {
  return sshHostGroupsInTreeOrder(data).map((entry) => entry.label)
}

describe('ssh host groups', () => {
  it('lists groups depth-first with their paths', () => {
    expect(order(tree)).toEqual([
      'Clients',
      'Clients / Acme',
      'Clients / Acme / prod',
      'Clients / Globex',
      'Internal'
    ])
    expect(formatSshHostGroupPath(tree, 'prod')).toBe('Clients / Acme / prod')
    expect(formatSshHostGroupPath(tree, null)).toBe('')
  })

  it('normalizes names and compares sibling names case-insensitively', () => {
    expect(normalizeSshHostGroupName('  Prod  ')).toBe('Prod')
    expect(normalizeSshHostGroupName('   ')).toBeNull()
    expect(isSshHostGroupNameTaken(tree, 'acme', 'clients')).toBe(true)
    expect(isSshHostGroupNameTaken(tree, 'acme', null)).toBe(false)
    expect(isSshHostGroupNameTaken(tree, 'ACME', 'clients', 'acme')).toBe(false)
  })

  it('treats a host whose group is gone as ungrouped', () => {
    const data = { ...tree, hostGroups: { ...tree.hostGroups, lost: 'deleted-group' } }
    expect(sshHostGroupIdOf(data, 'lost')).toBeNull()
    expect(sshHostGroupIdOf(data, 'web')).toBe('prod')
  })

  it('adds a group and unfolds its parents', () => {
    const folded = { ...tree, collapsed: ['clients', 'acme', 'internal'] }
    const next = addSshHostGroup(folded, { id: 'staging', name: 'staging', parentId: 'acme' })
    expect(order(next)).toContain('Clients / Acme / staging')
    expect(next.collapsed).toEqual(['internal'])
  })

  it('renames without touching the original', () => {
    const next = renameSshHostGroup(tree, 'acme', 'ACME Corp')
    expect(formatSshHostGroupPath(next, 'prod')).toBe('Clients / ACME Corp / prod')
    expect(formatSshHostGroupPath(tree, 'prod')).toBe('Clients / Acme / prod')
  })

  it('ungroups by moving hosts and subgroups up to the parent', () => {
    const next = ungroupSshHostGroup({ ...tree, collapsed: ['acme'] }, 'acme')
    expect(order(next)).toEqual(['Clients', 'Clients / prod', 'Clients / Globex', 'Internal'])
    expect(next.hostGroups).toEqual({ web: 'prod', ci: 'internal', db: 'clients' })
    expect(next.collapsed).toEqual([])
  })

  it('ungroups a top-level group by leaving its hosts ungrouped', () => {
    const next = ungroupSshHostGroup(tree, 'internal')
    expect(next.hostGroups).toEqual({ web: 'prod', db: 'acme' })
  })

  it('moves hosts into a group, unfolding it, or out of every group', () => {
    const folded = { ...tree, collapsed: ['clients', 'acme', 'internal'] }
    const filed = moveSshHostsToGroup(folded, ['ci', 'new'], 'acme')
    expect(filed.hostGroups).toEqual({ web: 'prod', ci: 'acme', db: 'acme', new: 'acme' })
    expect(filed.collapsed).toEqual(['internal'])

    expect(moveSshHostsToGroup(tree, ['web'], null).hostGroups).toEqual({
      ci: 'internal',
      db: 'acme'
    })
  })

  it('nests, reorders and lifts groups', () => {
    expect(order(moveSshHostGroup(tree, 'internal', { kind: 'inside', groupId: 'acme' }))).toEqual([
      'Clients',
      'Clients / Acme',
      'Clients / Acme / prod',
      'Clients / Acme / Internal',
      'Clients / Globex'
    ])
    expect(
      order(moveSshHostGroup(tree, 'globex', { kind: 'before', groupId: 'acme' })).slice(0, 3)
    ).toEqual(['Clients', 'Clients / Globex', 'Clients / Acme'])
    expect(
      order(moveSshHostGroup(tree, 'clients', { kind: 'after', groupId: 'internal' }))[0]
    ).toBe('Internal')
    expect(order(moveSshHostGroup(tree, 'prod', { kind: 'inside', groupId: null })).at(-1)).toBe(
      'prod'
    )
  })

  it('refuses moves into the group itself, its subgroups, or beside a same-named sibling', () => {
    expect(canMoveSshHostGroup(tree, 'clients', { kind: 'inside', groupId: 'prod' })).toBe(false)
    expect(canMoveSshHostGroup(tree, 'clients', { kind: 'before', groupId: 'acme' })).toBe(false)
    expect(canMoveSshHostGroup(tree, 'acme', { kind: 'inside', groupId: 'acme' })).toBe(false)
    expect(moveSshHostGroup(tree, 'clients', { kind: 'inside', groupId: 'prod' })).toBe(tree)

    const clash = addSshHostGroup(tree, { id: 'other-prod', name: 'Prod', parentId: null })
    expect(canMoveSshHostGroup(clash, 'prod', { kind: 'inside', groupId: null })).toBe(false)
    expect(canMoveSshHostGroup(clash, 'prod', { kind: 'inside', groupId: 'internal' })).toBe(true)
    // Reordering among its own siblings never clashes.
    expect(canMoveSshHostGroup(tree, 'globex', { kind: 'before', groupId: 'acme' })).toBe(true)
  })

  it('folds and unfolds', () => {
    const folded = setSshHostGroupCollapsed(EMPTY_SSH_HOST_GROUPS, 'acme', true)
    expect(folded.collapsed).toEqual(['acme'])
    expect(setSshHostGroupCollapsed(folded, 'acme', true).collapsed).toEqual(['acme'])
    expect(setSshHostGroupCollapsed(folded, 'acme', false).collapsed).toEqual([])
  })
})
