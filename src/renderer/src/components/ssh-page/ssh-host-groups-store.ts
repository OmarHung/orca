import { create } from 'zustand'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  addSshHostGroup,
  EMPTY_SSH_HOST_GROUPS,
  moveSshHostGroup,
  moveSshHostsToGroup,
  renameSshHostGroup,
  setSshHostGroupCollapsed,
  sshHostGroupPath,
  SSH_HOST_GROUP_NAME_MAX_LENGTH,
  ungroupSshHostGroup,
  type SshHostGroup,
  type SshHostGroupPlacement,
  type SshHostGroupsData
} from './ssh-host-groups'

// Why localStorage, not the app store: groups only arrange the fork's SSH/SFTP host lists, so
// they stay out of upstream's persisted state (same approach as the SFTP favorite folders).
const STORAGE_KEY = 'orca.sshHostGroups'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseGroups(raw: unknown): SshHostGroup[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const groups: SshHostGroup[] = []
  const ids = new Set<string>()
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || ids.has(entry.id)) {
      continue
    }
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      continue
    }
    ids.add(entry.id)
    groups.push({
      id: entry.id,
      name: entry.name.trim().slice(0, SSH_HOST_GROUP_NAME_MAX_LENGTH),
      parentId: typeof entry.parentId === 'string' ? entry.parentId : null
    })
  }
  // Why: a missing parent or a parent cycle would hide the group; lift it to the top level.
  const known = groups.map((group) =>
    group.parentId !== null && ids.has(group.parentId) ? group : { ...group, parentId: null }
  )
  const draft = { groups: known, hostGroups: {}, collapsed: [] }
  return known.map((group) =>
    group.parentId !== null &&
    sshHostGroupPath(draft, group.parentId).some((ancestor) => ancestor.id === group.id)
      ? { ...group, parentId: null }
      : group
  )
}

/** Stored groups, dropping anything malformed so a bad entry never breaks the host list. */
export function parseSshHostGroupsData(raw: unknown): SshHostGroupsData {
  if (!isRecord(raw)) {
    return EMPTY_SSH_HOST_GROUPS
  }
  const groups = parseGroups(raw.groups)
  const ids = new Set(groups.map((group) => group.id))
  const hostGroups: Record<string, string> = {}
  if (isRecord(raw.hostGroups)) {
    for (const [targetId, groupId] of Object.entries(raw.hostGroups)) {
      if (typeof groupId === 'string' && ids.has(groupId)) {
        hostGroups[targetId] = groupId
      }
    }
  }
  const collapsed = Array.isArray(raw.collapsed)
    ? raw.collapsed.filter((entry): entry is string => typeof entry === 'string')
    : []
  return { groups, hostGroups, collapsed }
}

function readStoredGroups(): SshHostGroupsData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? parseSshHostGroupsData(JSON.parse(raw)) : EMPTY_SSH_HOST_GROUPS
  } catch {
    // Corrupt or unavailable storage starts without groups.
    return EMPTY_SSH_HOST_GROUPS
  }
}

function writeStoredGroups(data: SshHostGroupsData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage can be unavailable; the groups just won't survive a reload.
  }
}

type SshHostGroupsState = {
  data: SshHostGroupsData
  update: (change: (data: SshHostGroupsData) => SshHostGroupsData) => void
}

export const useSshHostGroups = create<SshHostGroupsState>((set, get) => ({
  data: readStoredGroups(),
  update: (change) => {
    const current = get().data
    const next = change(current)
    if (next !== current) {
      writeStoredGroups(next)
      set({ data: next })
    }
  }
}))

function update(change: (data: SshHostGroupsData) => SshHostGroupsData): void {
  useSshHostGroups.getState().update(change)
}

export const sshHostGroupActions = {
  /** Creates a group (null parent: top level) and files `targetIds` in it. */
  create(name: string, parentId: string | null, targetIds: readonly string[] = []): void {
    const group = { id: createBrowserUuid(), name, parentId }
    update((data) => moveSshHostsToGroup(addSshHostGroup(data, group), targetIds, group.id))
  },
  rename(id: string, name: string): void {
    update((data) => renameSshHostGroup(data, id, name))
  },
  ungroup(id: string): void {
    update((data) => ungroupSshHostGroup(data, id))
  },
  moveHosts(targetIds: readonly string[], groupId: string | null): void {
    update((data) => moveSshHostsToGroup(data, targetIds, groupId))
  },
  moveGroup(id: string, placement: SshHostGroupPlacement): void {
    update((data) => moveSshHostGroup(data, id, placement))
  },
  setCollapsed(id: string, collapsed: boolean): void {
    update((data) => setSshHostGroupCollapsed(data, id, collapsed))
  }
}
