import { useEffect, useRef } from 'react'
import { useRunConfigurationStore } from './run-configuration-store'
import { useRunSessionStore } from './run-session-store'
import { useSelectedRunPanelSession } from './use-run-panel-sessions'
import type { RunWidgetFootprint } from './run-widget-activity'
import { runWidgetItemForRun, type RunWidgetItem } from './run-widget-items'

/**
 * Selects the run the Run panel switches to, once per switch, so a later pick from the menu still
 * wins until the next switch. A selected compound already covers its members, so moving between
 * their runs keeps it selected.
 */
export function useFollowActiveRunTerminal({
  worktreeId,
  repoId,
  items,
  selectedFootprint
}: {
  worktreeId: string
  repoId: string | undefined
  items: readonly RunWidgetItem[]
  selectedFootprint: RunWidgetFootprint | null
}): void {
  const select = useRunConfigurationStore((s) => s.select)
  const activeTerminalTabId = useSelectedRunPanelSession(worktreeId)?.tabId ?? null
  const activeRunKey = useRunSessionStore((s) =>
    activeTerminalTabId
      ? Object.values(s.sessionsByKey).find(
          (session) => session.worktreeId === worktreeId && session.tabId === activeTerminalTabId
        )?.commandKey
      : undefined
  )
  const activeRunItemKey = activeRunKey ? runWidgetItemForRun(items, activeRunKey)?.key : undefined
  const activeRunCovered =
    activeRunKey !== undefined && (selectedFootprint?.commandKeys.includes(activeRunKey) ?? false)
  const followedTabRef = useRef<string | null>(null)
  useEffect(() => {
    if (repoId === undefined || !activeTerminalTabId || !activeRunItemKey) {
      return
    }
    if (followedTabRef.current === activeTerminalTabId) {
      return
    }
    followedTabRef.current = activeTerminalTabId
    if (!activeRunCovered) {
      select(repoId, activeRunItemKey)
    }
  }, [activeTerminalTabId, activeRunItemKey, activeRunCovered, repoId, select])
}
