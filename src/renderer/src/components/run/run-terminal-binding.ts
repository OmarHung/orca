import type { useAppStore } from '@/store'
import type { TerminalPaneLayoutNode } from '../../../../shared/terminal-tab-types'

type RunTerminalState = Pick<
  ReturnType<typeof useAppStore.getState>,
  'ptyIdsByTabId' | 'tabsByWorktree' | 'terminalLayoutsByTabId'
>

export type RunTerminalBinding = {
  tabId: string
  leafId: string
  ptyId: string | null
}

function layoutContainsLeaf(
  node: TerminalPaneLayoutNode | null | undefined,
  leafId: string
): boolean {
  if (!node) {
    return false
  }
  return node.type === 'leaf'
    ? node.leafId === leafId
    : layoutContainsLeaf(node.first, leafId) || layoutContainsLeaf(node.second, leafId)
}

/** Resolves a run's stable pane after split-pane detach or PTY replacement. */
export function resolveRunTerminalBinding(
  state: RunTerminalState,
  worktreeId: string,
  leafId: string
): RunTerminalBinding | null {
  for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
    const layout = state.terminalLayoutsByTabId[tab.id]
    if (!layoutContainsLeaf(layout?.root, leafId)) {
      continue
    }
    const candidatePtyId = layout?.ptyIdsByLeafId?.[leafId]
    const ptyId =
      candidatePtyId && (state.ptyIdsByTabId[tab.id] ?? []).includes(candidatePtyId)
        ? candidatePtyId
        : null
    return { tabId: tab.id, leafId, ptyId }
  }
  return null
}
