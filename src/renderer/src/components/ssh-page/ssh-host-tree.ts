import type { SshTarget } from '../../../../shared/ssh-types'
import { filterSshTargetsBySearchQuery } from '../settings/ssh-target-search'
import {
  formatSshHostGroupPath,
  sshHostGroupIdOf,
  UNGROUPED_SECTION_ID,
  type SshHostGroup,
  type SshHostGroupsData
} from './ssh-host-groups'

export type SshHostTreeRow =
  | {
      kind: 'group'
      key: string
      group: SshHostGroup
      depth: number
      hostCount: number
      expanded: boolean
    }
  | { kind: 'host'; key: string; target: SshTarget; depth: number; groupId: string | null }
  | { kind: 'ungrouped'; key: string; hostCount: number; expanded: boolean }

export function sshHostGroupRowKey(groupId: string): string {
  return `g:${groupId}`
}

export function sshHostRowKey(targetId: string): string {
  return `h:${targetId}`
}

export const UNGROUPED_ROW_KEY = UNGROUPED_SECTION_ID

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

/**
 * The host list as rows: groups depth-first (subgroups before hosts), then the ungrouped hosts
 * under their own heading. Without groups the list stays flat. A search also matches group
 * names, hides groups without matches and unfolds the rest.
 */
export function buildSshHostTreeRows(
  targets: readonly SshTarget[],
  data: SshHostGroupsData,
  query: string
): SshHostTreeRow[] {
  const isSearching = query.trim() !== ''
  const visibleTargets = filterSshTargetsBySearchQuery(targets, query, (target) =>
    formatSshHostGroupPath(data, sshHostGroupIdOf(data, target.id))
  )
  const hostsByGroup = groupBy(visibleTargets, (target) => sshHostGroupIdOf(data, target.id))
  const knownIds = new Set(data.groups.map((group) => group.id))
  const childGroups = groupBy(data.groups, (group) =>
    group.parentId !== null && knownIds.has(group.parentId) ? group.parentId : null
  )
  const collapsed = new Set(data.collapsed)

  const countMemo = new Map<string, number>()
  const hostCount = (groupId: string): number => {
    const cached = countMemo.get(groupId)
    if (cached !== undefined) {
      return cached
    }
    countMemo.set(groupId, 0)
    const count =
      (hostsByGroup.get(groupId)?.length ?? 0) +
      (childGroups.get(groupId) ?? []).reduce((sum, child) => sum + hostCount(child.id), 0)
    countMemo.set(groupId, count)
    return count
  }

  const rows: SshHostTreeRow[] = []
  const hostRows = (groupId: string | null, depth: number): SshHostTreeRow[] =>
    (hostsByGroup.get(groupId) ?? []).map((target) => ({
      kind: 'host',
      key: sshHostRowKey(target.id),
      target,
      depth,
      groupId
    }))
  const visited = new Set<string>()
  const visit = (group: SshHostGroup, depth: number): void => {
    const count = hostCount(group.id)
    if (visited.has(group.id) || (isSearching && count === 0)) {
      return
    }
    visited.add(group.id)
    const expanded = isSearching || !collapsed.has(group.id)
    rows.push({
      kind: 'group',
      key: sshHostGroupRowKey(group.id),
      group,
      depth,
      hostCount: count,
      expanded
    })
    if (expanded) {
      for (const child of childGroups.get(group.id) ?? []) {
        visit(child, depth + 1)
      }
      rows.push(...hostRows(group.id, depth + 1))
    }
  }
  for (const group of childGroups.get(null) ?? []) {
    visit(group, 0)
  }

  const ungrouped = hostRows(null, 1)
  if (rows.length === 0) {
    return ungrouped.map((row) => ({ ...row, depth: 0 }))
  }
  // Why kept while empty: it is where hosts are dragged out of their groups.
  if (ungrouped.length > 0 || !isSearching) {
    const expanded = isSearching || !collapsed.has(UNGROUPED_SECTION_ID)
    rows.push({
      kind: 'ungrouped',
      key: UNGROUPED_ROW_KEY,
      hostCount: ungrouped.length,
      expanded
    })
    if (expanded) {
      rows.push(...ungrouped)
    }
  }
  return rows
}
