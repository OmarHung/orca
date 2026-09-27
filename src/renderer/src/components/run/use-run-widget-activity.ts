import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useDebugStore } from '../debug/debug-store'
import { useRunSessionStore } from './run-session-store'
import { worktreeRunActivity, type RunWidgetActivity } from './run-widget-activity'

/** The worktree's live runs and debug session, for the Run widget's status and Stop controls. */
export function useRunWidgetActivity(worktreeId: string): RunWidgetActivity {
  const sessionsByKey = useRunSessionStore((s) => s.sessionsByKey)
  const tabs = useAppStore((s) => s.tabsByWorktree[worktreeId])
  const debug = useDebugStore((s) => s.session)
  return useMemo(
    () =>
      worktreeRunActivity({
        worktreeId,
        sessions: Object.values(sessionsByKey),
        liveTabIds: new Set((tabs ?? []).map((tab) => tab.id)),
        debug
      }),
    [worktreeId, sessionsByKey, tabs, debug]
  )
}
