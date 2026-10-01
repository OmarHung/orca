import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { useRunPanelStore } from './run-panel-store'
import { useRunSessionStore, type RunSession } from './run-session-store'

const NO_TERMINAL_TAB_IDS: readonly string[] = []

/** Terminal tabs the Run panel owns in this workspace, finished runs included. */
export function useRunPanelTabIds(worktreeId: string): ReadonlySet<string> {
  const tabIds = useRunSessionStore(
    useShallow((s) =>
      Object.values(s.sessionsByKey)
        .filter((session) => session.worktreeId === worktreeId)
        .map((session) => session.tabId)
    )
  )
  return useMemo(() => new Set(tabIds), [tabIds])
}

/** The workspace's runs whose terminal still exists, in launch order. */
export function useRunPanelSessions(worktreeId: string): RunSession[] {
  const sessions = useRunSessionStore(
    useShallow((s) =>
      Object.values(s.sessionsByKey).filter((session) => session.worktreeId === worktreeId)
    )
  )
  const liveTabIds = useAppStore(
    useShallow((s) => s.tabsByWorktree[worktreeId]?.map((tab) => tab.id) ?? NO_TERMINAL_TAB_IDS)
  )
  return useMemo(() => {
    const live = new Set(liveTabIds)
    return sessions.filter((session) => live.has(session.tabId))
  }, [liveTabIds, sessions])
}

export function selectedRunPanelSession(
  sessions: readonly RunSession[],
  selectedCommandKey: string | undefined
): RunSession | null {
  return (
    sessions.find((session) => session.commandKey === selectedCommandKey) ?? sessions.at(-1) ?? null
  )
}

export function useSelectedRunPanelSession(worktreeId: string): RunSession | null {
  const sessions = useRunPanelSessions(worktreeId)
  const selectedKey = useRunPanelStore((s) => s.selectedByWorktree[worktreeId])
  return selectedRunPanelSession(sessions, selectedKey)
}
