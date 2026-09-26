import { create } from 'zustand'
import type { RunTarget } from './run-configuration-control'

/** `finished` is a clean exit whose code the shell did not report. */
export type RunSessionStatus =
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'finished'

export type RunSession = {
  key: string
  worktreeId: string
  commandKey: string
  label: string
  tabId: string
  status: RunSessionStatus
  exitCode: number | null
}

export function runSessionKey(worktreeId: string, commandKey: string): string {
  return `${worktreeId}\u0000${commandKey}`
}

export function isRunSessionActive(status: RunSessionStatus): boolean {
  return status === 'running' || status === 'stopping'
}

export function finishRunSession(session: RunSession, exitCode: number | null): RunSession {
  if (!isRunSessionActive(session.status)) {
    return session
  }
  const status: RunSessionStatus =
    session.status === 'stopping'
      ? 'stopped'
      : exitCode === null
        ? 'finished'
        : exitCode === 0
          ? 'succeeded'
          : 'failed'
  return { ...session, status, exitCode }
}

type RunSessionState = {
  sessionsByKey: Record<string, RunSession>
  /** Worktree id → the detected configuration last run there, for the tab bar controls. */
  lastDetectedRunByWorktree: Record<string, RunTarget>
  rememberDetectedRun: (target: RunTarget) => void
  upsertSession: (session: RunSession) => void
  setStatus: (key: string, status: RunSessionStatus) => void
  /** Returns the session that finished, if the tab belonged to an active run. */
  finishByTab: (tabId: string, exitCode: number | null) => RunSession | null
}

// Why a standalone store: run state is per-window and transient, and staying out of the
// synced app store keeps this fork feature isolated from upstream store changes.
export const useRunSessionStore = create<RunSessionState>((set, get) => ({
  sessionsByKey: {},
  lastDetectedRunByWorktree: {},
  rememberDetectedRun: (target) =>
    set({
      lastDetectedRunByWorktree: { ...get().lastDetectedRunByWorktree, [target.worktreeId]: target }
    }),
  upsertSession: (session) =>
    set({ sessionsByKey: { ...get().sessionsByKey, [session.key]: session } }),
  setStatus: (key, status) => {
    const session = get().sessionsByKey[key]
    if (session) {
      set({ sessionsByKey: { ...get().sessionsByKey, [key]: { ...session, status } } })
    }
  },
  finishByTab: (tabId, exitCode) => {
    const session = Object.values(get().sessionsByKey).find(
      (candidate) => candidate.tabId === tabId && isRunSessionActive(candidate.status)
    )
    if (!session) {
      return null
    }
    const finished = finishRunSession(session, exitCode)
    set({ sessionsByKey: { ...get().sessionsByKey, [session.key]: finished } })
    return finished
  }
}))
