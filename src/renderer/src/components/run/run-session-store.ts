import { create } from 'zustand'

/** `finished` is a clean exit whose code the shell did not report. */
export type RunSessionStatus =
  | 'queued'
  | 'running'
  | 'stopping'
  | 'unverifiable'
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
  /** Durable layout identity; unlike tab and PTY ids, this survives pane detach and rebind. */
  leafId: string
  /** Prevents an older async stop/rerun from mutating its replacement run. */
  attemptId: string
  status: RunSessionStatus
  exitCode: number | null
  /** Stop already sent the forceful signals; the next press closes the terminal. */
  forceStopped?: boolean
}

/** What the next Stop press does: Ctrl-C, then Ctrl-C with SIGQUIT, then closing the terminal. */
export type RunStopStage = 'interrupt' | 'force' | 'close'

const STOP_STAGE_ORDER: readonly RunStopStage[] = ['interrupt', 'force', 'close']

export function runSessionKey(worktreeId: string, commandKey: string): string {
  return `${worktreeId}\u0000${commandKey}`
}

export function isRunSessionActive(status: RunSessionStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'stopping' ||
    status === 'unverifiable'
  )
}

export function runStopStage(session: RunSession): RunStopStage {
  if (session.status === 'unverifiable') {
    return 'close'
  }
  if (session.status !== 'stopping') {
    return 'interrupt'
  }
  return session.forceStopped ? 'close' : 'force'
}

/** The gentlest next step among several runs, so one press never skips a run's gentler step. */
export function gentlestStopStage(stages: readonly RunStopStage[]): RunStopStage | null {
  return STOP_STAGE_ORDER.find((stage) => stages.includes(stage)) ?? null
}

export function finishRunSession(session: RunSession, exitCode: number | null): RunSession {
  if (!isRunSessionActive(session.status)) {
    return session
  }
  const status: RunSessionStatus =
    session.status === 'stopping' || session.status === 'unverifiable'
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
  upsertSession: (session: RunSession) => void
  setStatus: (key: string, attemptId: string, status: RunSessionStatus) => void
  setTabId: (key: string, attemptId: string, tabId: string) => void
  markForceStopped: (key: string, attemptId: string) => void
  markRunningByLeafId: (leafId: string) => void
  /** Returns the active run that owns the stable pane, if any. */
  finishByLeafId: (leafId: string, exitCode: number | null) => RunSession | null
  finishAttempt: (key: string, attemptId: string, exitCode: number | null) => RunSession | null
}

// Why a standalone store: run state is per-window and transient, and staying out of the
// synced app store keeps this fork feature isolated from upstream store changes.
export const useRunSessionStore = create<RunSessionState>((set, get) => ({
  sessionsByKey: {},
  upsertSession: (session) =>
    set({ sessionsByKey: { ...get().sessionsByKey, [session.key]: session } }),
  setStatus: (key, attemptId, status) => {
    const session = get().sessionsByKey[key]
    if (session?.attemptId === attemptId && isRunSessionActive(session.status)) {
      set({ sessionsByKey: { ...get().sessionsByKey, [key]: { ...session, status } } })
    }
  },
  setTabId: (key, attemptId, tabId) => {
    const session = get().sessionsByKey[key]
    if (session?.attemptId === attemptId && session.tabId !== tabId) {
      set({ sessionsByKey: { ...get().sessionsByKey, [key]: { ...session, tabId } } })
    }
  },
  markForceStopped: (key, attemptId) => {
    const session = get().sessionsByKey[key]
    if (session?.attemptId === attemptId) {
      set({ sessionsByKey: { ...get().sessionsByKey, [key]: { ...session, forceStopped: true } } })
    }
  },
  markRunningByLeafId: (leafId) => {
    const session = Object.values(get().sessionsByKey).find(
      (candidate) => candidate.leafId === leafId && candidate.status === 'queued'
    )
    if (session) {
      set({
        sessionsByKey: {
          ...get().sessionsByKey,
          [session.key]: { ...session, status: 'running' }
        }
      })
    }
  },
  finishByLeafId: (leafId, exitCode) => {
    const session = Object.values(get().sessionsByKey).find(
      (candidate) => candidate.leafId === leafId && isRunSessionActive(candidate.status)
    )
    if (!session) {
      return null
    }
    const finished = finishRunSession(session, exitCode)
    set({ sessionsByKey: { ...get().sessionsByKey, [session.key]: finished } })
    return finished
  },
  finishAttempt: (key, attemptId, exitCode) => {
    const session = get().sessionsByKey[key]
    if (!session || session.attemptId !== attemptId || !isRunSessionActive(session.status)) {
      return null
    }
    const finished = finishRunSession(session, exitCode)
    set({ sessionsByKey: { ...get().sessionsByKey, [key]: finished } })
    return finished
  }
}))
