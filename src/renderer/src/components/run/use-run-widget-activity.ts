import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useDebugStore } from '../debug/debug-store'
import { collectLayoutLeafIdsInOrder } from '../../../../shared/workspace-layout/terminal-pane-tree'
import { useRunSessionStore } from './run-session-store'
import { worktreeRunActivity, type RunWidgetActivity } from './run-widget-activity'

/** The worktree's live runs and debug sessions, for the Run widget's status and Stop controls. */
export function useRunWidgetActivity(worktreeId: string): RunWidgetActivity {
  const sessionsByKey = useRunSessionStore((s) => s.sessionsByKey)
  const tabs = useAppStore((s) => s.tabsByWorktree[worktreeId])
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const debugSessions = useDebugStore((s) => s.sessions)
  return useMemo(() => {
    const liveLeafIds = new Set(
      (tabs ?? []).flatMap((tab) =>
        collectLayoutLeafIdsInOrder(terminalLayoutsByTabId[tab.id]?.root)
      )
    )
    return worktreeRunActivity({
      worktreeId,
      sessions: Object.values(sessionsByKey),
      liveLeafIds,
      debugSessions
    })
  }, [worktreeId, sessionsByKey, tabs, terminalLayoutsByTabId, debugSessions])
}
