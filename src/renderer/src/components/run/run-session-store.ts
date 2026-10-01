import { create } from 'zustand'
import { readStoredRunTarget } from './recent-run-store'
import type { RunTarget } from './run-target'

const STORAGE_KEY = 'orca.run.sessionsByKey.v1'

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
  /** What the Run panel's Rerun starts again. */
  target?: RunTarget
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

const RUN_SESSION_STATUSES: ReadonlySet<string> = new Set<RunSessionStatus>([
  'queued',
  'running',
  'stopping',
  'unverifiable',
  'succeeded',
  'failed',
  'stopped',
  'finished'
])

function isRunSessionStatus(value: unknown): value is RunSessionStatus {
  return typeof value === 'string' && RUN_SESSION_STATUSES.has(value)
}

function readStoredSession(value: unknown): RunSession | null {
  const record: Record<string, unknown> | null =
    typeof value === 'object' && value !== null ? { ...value } : null
  if (
    !record ||
    typeof record.worktreeId !== 'string' ||
    typeof record.commandKey !== 'string' ||
    typeof record.label !== 'string' ||
    typeof record.tabId !== 'string' ||
    typeof record.leafId !== 'string' ||
    typeof record.attemptId !== 'string' ||
    !isRunSessionStatus(record.status)
  ) {
    return null
  }
  const target = record.target === undefined ? null : readStoredRunTarget(record.target)
  // Why: the terminal outlives a restart, but whether its command still runs is unknown, so an
  // active run restarts its Stop ladder and Rerun interrupts it before typing again.
  const status =
    isRunSessionActive(record.status) && record.status !== 'unverifiable'
      ? 'running'
      : record.status
  return {
    key: runSessionKey(record.worktreeId, record.commandKey),
    worktreeId: record.worktreeId,
    commandKey: record.commandKey,
    label: record.label,
    tabId: record.tabId,
    leafId: record.leafId,
    attemptId: record.attemptId,
    status,
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
    ...(target ? { target } : {})
  }
}

export function readStoredRunSessions(): Record<string, RunSession> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    const sessions = Array.isArray(value) ? value.map(readStoredSession) : []
    return Object.fromEntries(
      sessions.flatMap((session) => (session ? [[session.key, session] as const] : []))
    )
  } catch {
    return {}
  }
}

function writeStoredRunSessions(sessionsByKey: Record<string, RunSession>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.values(sessionsByKey)))
  } catch {
    // Storage can be unavailable; run terminals then return to the tab bar after a restart.
  }
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
  removeSession: (key: string) => void
  /** Drops sessions whose terminal is gone, so stored runs do not pile up. */
  retainSessions: (keep: (session: RunSession) => boolean) => void
}

// Why a standalone store: run state is per-window, and staying out of the synced app store keeps
// this fork feature isolated from upstream store changes. Why localStorage: run terminals survive
// a restart, and the Run panel must still own them (not the tab bar) afterwards.
export const useRunSessionStore = create<RunSessionState>((set, get) => ({
  sessionsByKey: readStoredRunSessions(),
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
  },
  removeSession: (key) => {
    if (get().sessionsByKey[key]) {
      const { [key]: _removed, ...rest } = get().sessionsByKey
      set({ sessionsByKey: rest })
    }
  },
  retainSessions: (keep) => {
    const sessions = Object.values(get().sessionsByKey)
    const kept = sessions.filter(keep)
    if (kept.length !== sessions.length) {
      set({ sessionsByKey: Object.fromEntries(kept.map((session) => [session.key, session])) })
    }
  }
}))

/** Whether a terminal tab belongs to the Run panel rather than the tab bar. */
export function isRunPanelTerminalTab(tabId: string): boolean {
  return Object.values(useRunSessionStore.getState().sessionsByKey).some(
    (session) => session.tabId === tabId
  )
}

useRunSessionStore.subscribe((state, previous) => {
  if (state.sessionsByKey !== previous.sessionsByKey) {
    writeStoredRunSessions(state.sessionsByKey)
  }
})
