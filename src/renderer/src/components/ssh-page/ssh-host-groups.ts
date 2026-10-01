export type SshHostGroup = { id: string; name: string; parentId: string | null }

export type SshHostGroupsData = {
  /** Siblings show in array order. */
  groups: SshHostGroup[]
  /** Host target id → group id; ungrouped hosts are absent. */
  hostGroups: Record<string, string>
  /** Folded group ids, plus UNGROUPED_SECTION_ID for the ungrouped section. */
  collapsed: string[]
}

/** Where a moved group lands: as the last child of a group (null: top level), or next to one. */
export type SshHostGroupPlacement =
  | { kind: 'inside'; groupId: string | null }
  | { kind: 'before' | 'after'; groupId: string }

export const UNGROUPED_SECTION_ID = 'ungrouped'
export const SSH_HOST_GROUP_NAME_MAX_LENGTH = 100
export const EMPTY_SSH_HOST_GROUPS: SshHostGroupsData = {
  groups: [],
  hostGroups: {},
  collapsed: []
}

/** A typed group name as saved: trimmed, with blank meaning none. */
export function normalizeSshHostGroupName(input: string): string | null {
  const name = input.trim()
  return name === '' ? null : name
}

export function findSshHostGroup(data: SshHostGroupsData, id: string): SshHostGroup | undefined {
  return data.groups.find((group) => group.id === id)
}

/** The group a host sits in, or null when ungrouped or its group no longer exists. */
export function sshHostGroupIdOf(data: SshHostGroupsData, targetId: string): string | null {
  const groupId = data.hostGroups[targetId]
  return groupId !== undefined && findSshHostGroup(data, groupId) ? groupId : null
}

/** The group and its ancestors, outermost first. */
export function sshHostGroupPath(data: SshHostGroupsData, id: string | null): SshHostGroup[] {
  const path: SshHostGroup[] = []
  const seen = new Set<string>()
  let current = id === null ? undefined : findSshHostGroup(data, id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId === null ? undefined : findSshHostGroup(data, current.parentId)
  }
  return path
}

export function formatSshHostGroupPath(data: SshHostGroupsData, id: string | null): string {
  return sshHostGroupPath(data, id)
    .map((group) => group.name)
    .join(' / ')
}

/** The group's id plus every nested group's. */
export function sshHostGroupSubtreeIds(data: SshHostGroupsData, id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const group of data.groups) {
      if (group.parentId !== null && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id)
        grew = true
      }
    }
  }
  return ids
}

/** Sibling names compare case-insensitively, so "Prod" and "prod" can't sit side by side. */
export function isSshHostGroupNameTaken(
  data: SshHostGroupsData,
  name: string,
  parentId: string | null,
  exceptId?: string
): boolean {
  const key = name.trim().toLocaleLowerCase()
  return data.groups.some(
    (group) =>
      group.parentId === parentId && group.id !== exceptId && group.name.toLocaleLowerCase() === key
  )
}

function withExpanded(data: SshHostGroupsData, groupId: string | null): SshHostGroupsData {
  const unfold = new Set(sshHostGroupPath(data, groupId).map((group) => group.id))
  return unfold.size === 0
    ? data
    : { ...data, collapsed: data.collapsed.filter((id) => !unfold.has(id)) }
}

export function addSshHostGroup(data: SshHostGroupsData, group: SshHostGroup): SshHostGroupsData {
  return withExpanded({ ...data, groups: [...data.groups, group] }, group.parentId)
}

export function renameSshHostGroup(
  data: SshHostGroupsData,
  id: string,
  name: string
): SshHostGroupsData {
  return {
    ...data,
    groups: data.groups.map((group) => (group.id === id ? { ...group, name } : group))
  }
}

/** Removes the group; its hosts and subgroups move up to its parent. */
export function ungroupSshHostGroup(data: SshHostGroupsData, id: string): SshHostGroupsData {
  const removed = findSshHostGroup(data, id)
  if (!removed) {
    return data
  }
  const groups = data.groups
    .filter((group) => group.id !== id)
    .map((group) => (group.parentId === id ? { ...group, parentId: removed.parentId } : group))
  const hostGroups: Record<string, string> = {}
  for (const [targetId, groupId] of Object.entries(data.hostGroups)) {
    if (groupId !== id) {
      hostGroups[targetId] = groupId
    } else if (removed.parentId !== null) {
      hostGroups[targetId] = removed.parentId
    }
  }
  return { groups, hostGroups, collapsed: data.collapsed.filter((entry) => entry !== id) }
}

/** Files hosts under a group (null: ungrouped) and unfolds it so they stay in sight. */
export function moveSshHostsToGroup(
  data: SshHostGroupsData,
  targetIds: readonly string[],
  groupId: string | null
): SshHostGroupsData {
  const hostGroups = { ...data.hostGroups }
  for (const targetId of targetIds) {
    if (groupId === null) {
      delete hostGroups[targetId]
    } else {
      hostGroups[targetId] = groupId
    }
  }
  return withExpanded({ ...data, hostGroups }, groupId)
}

function placementParentId(
  data: SshHostGroupsData,
  placement: SshHostGroupPlacement
): string | null | undefined {
  if (placement.kind === 'inside') {
    return placement.groupId
  }
  return findSshHostGroup(data, placement.groupId)?.parentId
}

/** False for moves into the group itself or its subgroups, or next to a same-named sibling. */
export function canMoveSshHostGroup(
  data: SshHostGroupsData,
  id: string,
  placement: SshHostGroupPlacement
): boolean {
  const moved = findSshHostGroup(data, id)
  const parentId = placementParentId(data, placement)
  if (!moved || parentId === undefined) {
    return false
  }
  if (placement.groupId !== null && sshHostGroupSubtreeIds(data, id).has(placement.groupId)) {
    return false
  }
  return parentId === moved.parentId || !isSshHostGroupNameTaken(data, moved.name, parentId)
}

export function moveSshHostGroup(
  data: SshHostGroupsData,
  id: string,
  placement: SshHostGroupPlacement
): SshHostGroupsData {
  const moved = findSshHostGroup(data, id)
  const parentId = placementParentId(data, placement)
  if (!moved || parentId === undefined || !canMoveSshHostGroup(data, id, placement)) {
    return data
  }
  const groups = data.groups.filter((group) => group.id !== id)
  const next = { ...moved, parentId }
  if (placement.kind === 'inside') {
    groups.push(next)
  } else {
    const anchor = groups.findIndex((group) => group.id === placement.groupId)
    groups.splice(placement.kind === 'before' ? anchor : anchor + 1, 0, next)
  }
  return withExpanded({ ...data, groups }, parentId)
}

export function setSshHostGroupCollapsed(
  data: SshHostGroupsData,
  id: string,
  collapsed: boolean
): SshHostGroupsData {
  const rest = data.collapsed.filter((entry) => entry !== id)
  return { ...data, collapsed: collapsed ? [...rest, id] : rest }
}

/** Every group depth-first in display order, with its path label ("Parent / Child"). */
export function sshHostGroupsInTreeOrder(
  data: SshHostGroupsData
): { group: SshHostGroup; label: string }[] {
  const ordered: { group: SshHostGroup; label: string }[] = []
  const seen = new Set<string>()
  const visit = (parentId: string | null, prefix: string): void => {
    for (const group of data.groups) {
      if (group.parentId !== parentId || seen.has(group.id)) {
        continue
      }
      seen.add(group.id)
      const label = prefix ? `${prefix} / ${group.name}` : group.name
      ordered.push({ group, label })
      visit(group.id, label)
    }
  }
  visit(null, '')
  return ordered
}
