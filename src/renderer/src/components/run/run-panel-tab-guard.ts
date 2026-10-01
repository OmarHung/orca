import { useAppStore } from '@/store'
import { activateCyclableTab } from '@/hooks/ipc-tab-switch'
import { getActiveTabNavOrder } from '../tab-bar/group-tab-order'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { revealRunInPanel } from './run-panel-store'
import { releaseRunPanelTerminalHosts } from './run-panel-terminal-hosts'
import { useRunSessionStore } from './run-session-store'

type AppState = ReturnType<typeof useAppStore.getState>

let installed = false
let scheduled = false

function runTabIdsOf(worktreeId: string): Set<string> {
  return new Set(
    Object.values(useRunSessionStore.getState().sessionsByKey)
      .filter((session) => session.worktreeId === worktreeId)
      .map((session) => session.tabId)
  )
}

function isRunTab(tab: Tab | undefined, runTabIds: ReadonlySet<string>): boolean {
  return tab?.contentType === 'terminal' && runTabIds.has(tab.entityId)
}

/**
 * A split holding only run terminals would look empty yet never close, because it still has tabs.
 * Moving them to another group lets the store collapse it, as when its last tab closes.
 */
function mergeRunOnlyGroups(
  state: AppState,
  worktreeId: string,
  runTabIds: ReadonlySet<string>
): boolean {
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const tabsById = new Map((state.unifiedTabsByWorktree[worktreeId] ?? []).map((t) => [t.id, t]))
  const isRunOnly = (group: TabGroup): boolean =>
    group.tabOrder.length > 0 && group.tabOrder.every((id) => isRunTab(tabsById.get(id), runTabIds))
  const runOnly = groups.filter(isRunOnly)
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const host =
    groups.find((group) => group.id === activeGroupId && !isRunOnly(group)) ??
    groups.find((group) => !isRunOnly(group))
  if (runOnly.length === 0 || !host) {
    return false
  }
  for (const group of runOnly) {
    for (const tabId of group.tabOrder) {
      state.moveUnifiedTabToGroup(tabId, host.id, { activate: false })
    }
  }
  return true
}

/** A run terminal that became its group's active tab hands the group back to a visible tab. */
function restoreVisibleActiveTab(
  state: AppState,
  worktreeId: string,
  runTabIds: ReadonlySet<string>
): void {
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const group = (state.groupsByWorktree[worktreeId] ?? []).find((g) => g.id === activeGroupId)
  const active = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.id === group?.activeTabId
  )
  if (!group || !active || !isRunTab(active, runTabIds)) {
    return
  }
  // Why the MRU tail: activation pushes there, while close fallbacks and background creation don't,
  // so this tells a user who asked for the run (palette, CLI focus) from one landing on it.
  if (group.recentTabIds?.at(-1) === active.id) {
    const session = Object.values(useRunSessionStore.getState().sessionsByKey).find(
      (candidate) => candidate.tabId === active.entityId
    )
    if (session) {
      revealRunInPanel(worktreeId, session.commandKey)
    }
  }
  const visible = getActiveTabNavOrder(state, worktreeId)
  const next =
    (group.recentTabIds ?? [])
      .toReversed()
      .map((id) => visible.find((ref) => ref.tabId === id))
      .find((ref) => ref !== undefined) ?? visible[0]
  if (next) {
    activateCyclableTab(state, next)
  }
}

function enforce(): void {
  scheduled = false
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId || !state.workspaceSessionReady) {
    return
  }
  const runTabIds = runTabIdsOf(worktreeId)
  if (runTabIds.size === 0) {
    return
  }
  if (mergeRunOnlyGroups(state, worktreeId, runTabIds)) {
    return
  }
  restoreVisibleActiveTab(state, worktreeId, runTabIds)
}

function schedule(): void {
  if (!scheduled) {
    scheduled = true
    // Why a microtask: acting inside another action's store write could break its later steps.
    queueMicrotask(enforce)
  }
}

/** Keeps run terminals out of tab groups' visible state; idempotent. */
export function ensureRunPanelTabGuard(): void {
  if (installed) {
    return
  }
  installed = true
  useAppStore.subscribe((state, previous) => {
    if (
      state.groupsByWorktree !== previous.groupsByWorktree ||
      state.activeGroupIdByWorktree !== previous.activeGroupIdByWorktree ||
      state.activeWorktreeId !== previous.activeWorktreeId ||
      state.workspaceSessionReady !== previous.workspaceSessionReady
    ) {
      schedule()
    }
  })
  useRunSessionStore.subscribe((state, previous) => {
    if (state.sessionsByKey !== previous.sessionsByKey) {
      releaseRunPanelTerminalHosts(
        new Set(Object.values(state.sessionsByKey).map((session) => session.tabId))
      )
      schedule()
    }
  })
  schedule()
}
