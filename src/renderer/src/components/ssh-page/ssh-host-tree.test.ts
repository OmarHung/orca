import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import {
  EMPTY_SSH_HOST_GROUPS,
  UNGROUPED_SECTION_ID,
  type SshHostGroupsData
} from './ssh-host-groups'
import { buildSshHostTreeRows, type SshHostTreeRow } from './ssh-host-tree'

function target(id: string, host: string): SshTarget {
  return { id, label: id, host, port: 22, username: 'deploy' }
}

const targets = [
  target('web', '203.0.113.10'),
  target('api', '203.0.113.11'),
  target('ci', '198.51.100.7'),
  target('lab', '192.0.2.5')
]

const data: SshHostGroupsData = {
  groups: [
    { id: 'clients', name: 'Clients', parentId: null },
    { id: 'acme', name: 'Acme', parentId: 'clients' },
    { id: 'internal', name: 'Internal', parentId: null },
    { id: 'empty', name: 'Empty', parentId: null }
  ],
  hostGroups: { web: 'acme', api: 'clients', ci: 'internal' },
  collapsed: []
}

/** Rows as indented text: `+` group, `-` host, `~` ungrouped heading, with counts. */
function outline(rows: SshHostTreeRow[]): string[] {
  return rows.map((row) => {
    if (row.kind === 'ungrouped') {
      return `~ Ungrouped (${row.hostCount})`
    }
    const indent = '  '.repeat(row.depth)
    return row.kind === 'group'
      ? `${indent}+ ${row.group.name} (${row.hostCount})`
      : `${indent}- ${row.target.id}`
  })
}

describe('buildSshHostTreeRows', () => {
  it('stays a flat list while there are no groups', () => {
    expect(outline(buildSshHostTreeRows(targets, EMPTY_SSH_HOST_GROUPS, ''))).toEqual([
      '- web',
      '- api',
      '- ci',
      '- lab'
    ])
  })

  it('nests subgroups before hosts and ends with the ungrouped hosts', () => {
    expect(outline(buildSshHostTreeRows(targets, data, ''))).toEqual([
      '+ Clients (2)',
      '  + Acme (1)',
      '    - web',
      '  - api',
      '+ Internal (1)',
      '  - ci',
      '+ Empty (0)',
      '~ Ungrouped (1)',
      '  - lab'
    ])
  })

  it('hides the hosts and subgroups of folded groups', () => {
    const folded = { ...data, collapsed: ['clients', UNGROUPED_SECTION_ID] }
    expect(outline(buildSshHostTreeRows(targets, folded, ''))).toEqual([
      '+ Clients (2)',
      '+ Internal (1)',
      '  - ci',
      '+ Empty (0)',
      '~ Ungrouped (1)'
    ])
  })

  it('keeps the ungrouped heading as a drop target when every host is grouped', () => {
    const allGrouped = { ...data, hostGroups: { ...data.hostGroups, lab: 'internal' } }
    expect(outline(buildSshHostTreeRows(targets, allGrouped, '')).at(-1)).toBe('~ Ungrouped (0)')
  })

  it('searches group names too, unfolding and keeping only groups with matches', () => {
    const folded = { ...data, collapsed: ['clients', 'acme'] }
    expect(outline(buildSshHostTreeRows(targets, folded, 'acme'))).toEqual([
      '+ Clients (1)',
      '  + Acme (1)',
      '    - web'
    ])
    // Only an ungrouped host matches, so no group shows and the list goes flat.
    expect(outline(buildSshHostTreeRows(targets, folded, '192.0.2'))).toEqual(['- lab'])
    expect(outline(buildSshHostTreeRows(targets, folded, 'deploy 198.51'))).toEqual([
      '+ Internal (1)',
      '  - ci'
    ])
  })

  it('shows groups whose parent was lost at the top level', () => {
    const orphaned = {
      ...EMPTY_SSH_HOST_GROUPS,
      groups: [{ id: 'orphan', name: 'Orphan', parentId: 'gone' }],
      hostGroups: { web: 'orphan' }
    }
    expect(outline(buildSshHostTreeRows(targets.slice(0, 1), orphaned, ''))).toEqual([
      '+ Orphan (1)',
      '  - web',
      '~ Ungrouped (0)'
    ])
  })
})
