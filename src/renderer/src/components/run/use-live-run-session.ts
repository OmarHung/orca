import { useAppStore } from '@/store'
import type { RunTarget } from './run-configuration-control'
import { runSessionKey, useRunSessionStore, type RunSession } from './run-session-store'

/** The target's run session while its terminal tab still exists; null once the tab is gone. */
export function useLiveRunSession(target: RunTarget | null): RunSession | null {
  const storedSession = useRunSessionStore((s) =>
    target ? s.sessionsByKey[runSessionKey(target.worktreeId, target.commandKey)] : undefined
  )
  const tabAlive = useAppStore((s) =>
    storedSession && target
      ? (s.tabsByWorktree[target.worktreeId] ?? []).some((tab) => tab.id === storedSession.tabId)
      : false
  )
  return storedSession && tabAlive ? storedSession : null
}
