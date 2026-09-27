import { useEffect, useRef } from 'react'
import { useRunConfigurationStore } from './run-configuration-store'
import { useRunSessionStore } from './run-session-store'
import type { RunWidgetFootprint } from './run-widget-activity'
import { runWidgetItemForRun, type RunWidgetItem } from './run-widget-items'

/**
 * Selects the run whose terminal tab becomes active, once per tab switch, so a later pick from the
 * menu still wins until the next switch. A selected compound already covers its members, so
 * moving between their terminals keeps it selected.
 */
export function useFollowActiveRunTerminal({
  worktreeId,
  repoId,
  activeTerminalTabId,
  items,
  selectedFootprint
}: {
  worktreeId: string
  repoId: string | undefined
  activeTerminalTabId: string | null
  items: readonly RunWidgetItem[]
  selectedFootprint: RunWidgetFootprint | null
}): void {
  const select = useRunConfigurationStore((s) => s.select)
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
