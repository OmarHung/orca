import { useMemo } from 'react'
import { runPanelTerminalHost } from './run-panel-terminal-hosts'
import { useRunPanelStore } from './run-panel-store'
import { useRunPanelTabIds } from './use-run-panel-sessions'

/** No tab group has this id, so a run terminal is never a group's visible or active terminal. */
export const RUN_PANEL_OVERLAY_GROUP_ID = 'orca-run-panel'

export type RunPanelTerminalPlacement = {
  tabIds: ReadonlySet<string>
  shownTabId: string | null
  focused: boolean
}

/** How the workspace's terminal overlay places the terminals the Run panel owns. */
export function useRunPanelTerminalPlacement(worktreeId: string): RunPanelTerminalPlacement {
  const tabIds = useRunPanelTabIds(worktreeId)
  const shownTabId = useRunPanelStore((s) =>
    s.shownTabId !== null && tabIds.has(s.shownTabId) ? s.shownTabId : null
  )
  const focused = useRunPanelStore((s) => s.focused)
  return useMemo(() => ({ tabIds, shownTabId, focused }), [focused, shownTabId, tabIds])
}

/** A run terminal counts as shown (for parking and rendering) only while the panel shows it. */
export function runPanelOverlayAssignment(
  placement: RunPanelTerminalPlacement,
  unifiedTabId: string,
  terminalTabId: string
): { unifiedTabId: string; groupId: string; isActiveInGroup: boolean } {
  return {
    unifiedTabId,
    groupId: RUN_PANEL_OVERLAY_GROUP_ID,
    isActiveInGroup: placement.shownTabId === terminalTabId
  }
}

export function runPanelHostFor(
  placement: RunPanelTerminalPlacement,
  terminalTabId: string
): HTMLElement | null {
  return placement.tabIds.has(terminalTabId) ? runPanelTerminalHost(terminalTabId) : null
}
