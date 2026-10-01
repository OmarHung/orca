import { create } from 'zustand'
import type { DebugProtocol } from '@vscode/debugprotocol'
import type {
  DebugExceptionFilter,
  DebugSessionPhase
} from '../../../../shared/debug/debug-session-types'

/** Keeps a chatty program from growing the console without bound. */
export const MAX_DEBUG_OUTPUT_ENTRIES = 2_000

export type DebugOutputEntry = {
  id: number
  category: 'stdout' | 'stderr' | 'console' | 'orca'
  text: string
}

export type DebugExecutionLocation = { path: string; line: number }

/** What other features (the Run widget) read about a session. */
export type DebugSessionView = {
  id: string
  worktreeId: string
  /** What is being debugged, e.g. a file name or "web: dev". */
  title: string
  /** The Run widget item that started it, so Run and Debug of one item exclude each other. */
  sourceKey?: string
  phase: DebugSessionPhase
  /** Set while paused; null while the program runs. */
  stoppedThreadId: number | null
  stopReason: string | null
}

type PausedState = {
  frames: DebugProtocol.StackFrame[]
  selectedFrameId: number | null
  scopes: DebugProtocol.Scope[]
  /** variablesReference → children, loaded lazily as the tree expands. */
  variablesByReference: Record<number, DebugProtocol.Variable[]>
  executionLocation: DebugExecutionLocation | null
}

/** One debug session, shown as a tab of the Debug tool window. */
export type DebugSession = DebugSessionView &
  PausedState & {
    /** Debugging the same thing again replaces this tab: its Run widget key, else its target. */
    identity: string
    adapterId: string
    /** The workspace root; only breakpoints under it, in the adapter's languages, reach it. */
    rootPath: string
    /** Exception filters the adapter offers; kept after it ends for the Breakpoints tab. */
    exceptionFilters: DebugExceptionFilter[]
    /** path → line → whether this session's adapter bound that breakpoint. */
    verifiedByFile: Record<string, Record<number, boolean>>
    lastError: string | null
  }

export type NewDebugSession = Pick<
  DebugSession,
  'id' | 'worktreeId' | 'title' | 'sourceKey' | 'identity' | 'adapterId' | 'rootPath'
>

const EMPTY_PAUSED_STATE: PausedState = {
  frames: [],
  selectedFrameId: null,
  scopes: [],
  variablesByReference: {},
  executionLocation: null
}

const NO_OUTPUT: readonly DebugOutputEntry[] = []

type DebugState = {
  /** Every session tab in start order, live or finished. */
  sessions: readonly DebugSession[]
  /** Kept apart from sessions so console output doesn't re-render readers of paused state. */
  outputBySession: Record<string, readonly DebugOutputEntry[]>
  /** worktreeId → the session tab the Debug panel shows. */
  selectedByWorktree: Record<string, string>
}

type DebugActions = {
  addSession: (session: NewDebugSession) => void
  removeSession: (id: string) => void
  selectSession: (worktreeId: string, id: string) => void
  updateSession: (id: string, patch: Partial<Omit<DebugSession, 'id'>>) => void
  setPausedState: (id: string, state: Omit<PausedState, 'variablesByReference'>) => void
  clearPausedState: (id: string) => void
  setVariables: (id: string, reference: number, variables: DebugProtocol.Variable[]) => void
  setVerified: (id: string, path: string, verified: Record<number, boolean>) => void
  appendOutput: (id: string, category: DebugOutputEntry['category'], text: string) => void
  setLastError: (id: string, message: string | null) => void
}

let nextOutputId = 1

export const isLiveDebugSession = (session: DebugSessionView): boolean => session.phase !== 'ended'

export function findDebugSession(
  sessions: readonly DebugSession[],
  id: string | null | undefined
): DebugSession | null {
  return sessions.find((session) => session.id === id) ?? null
}

/** The tab the Debug panel shows for a worktree: the chosen one, else its newest. */
export function selectedDebugSession(
  state: Pick<DebugState, 'sessions' | 'selectedByWorktree'>,
  worktreeId: string | null
): DebugSession | null {
  const own = state.sessions.filter((session) => session.worktreeId === worktreeId)
  const chosen = worktreeId ? state.selectedByWorktree[worktreeId] : undefined
  return own.find((session) => session.id === chosen) ?? own.at(-1) ?? null
}

/** The newest session paused in `path`, which drives that file's paused line, values and hover. */
export function pausedDebugSessionForFile(
  sessions: readonly DebugSession[],
  path: string
): DebugSession | null {
  return (
    sessions.findLast(
      (session) => session.stoppedThreadId !== null && session.executionLocation?.path === path
    ) ?? null
  )
}

export function debugOutput(
  state: Pick<DebugState, 'outputBySession'>,
  id: string
): readonly DebugOutputEntry[] {
  return state.outputBySession[id] ?? NO_OUTPUT
}

// Why a standalone store: debug state is per-window and transient, and keeping it out of
// the synced app store keeps this fork feature isolated from upstream store changes.
export const useDebugStore = create<DebugState & DebugActions>((set, get) => {
  const updateSession: DebugActions['updateSession'] = (id, patch) =>
    set({
      sessions: get().sessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session
      )
    })
  return {
    sessions: [],
    outputBySession: {},
    selectedByWorktree: {},
    addSession: (session) =>
      set({
        sessions: [
          ...get().sessions,
          {
            ...session,
            ...EMPTY_PAUSED_STATE,
            phase: 'starting',
            stoppedThreadId: null,
            stopReason: null,
            exceptionFilters: [],
            verifiedByFile: {},
            lastError: null
          }
        ],
        selectedByWorktree: { ...get().selectedByWorktree, [session.worktreeId]: session.id }
      }),
    removeSession: (id) => {
      const { [id]: _removed, ...outputBySession } = get().outputBySession
      set({ sessions: get().sessions.filter((session) => session.id !== id), outputBySession })
    },
    selectSession: (worktreeId, id) =>
      set({ selectedByWorktree: { ...get().selectedByWorktree, [worktreeId]: id } }),
    updateSession,
    setPausedState: (id, state) => updateSession(id, { ...state, variablesByReference: {} }),
    clearPausedState: (id) => updateSession(id, EMPTY_PAUSED_STATE),
    setVariables: (id, reference, variables) => {
      const session = findDebugSession(get().sessions, id)
      if (session) {
        updateSession(id, {
          variablesByReference: { ...session.variablesByReference, [reference]: variables }
        })
      }
    },
    setVerified: (id, path, verified) => {
      const session = findDebugSession(get().sessions, id)
      if (session) {
        updateSession(id, { verifiedByFile: { ...session.verifiedByFile, [path]: verified } })
      }
    },
    appendOutput: (id, category, text) => {
      const entry = { id: nextOutputId++, category, text }
      const output = [...debugOutput(get(), id), entry].slice(-MAX_DEBUG_OUTPUT_ENTRIES)
      set({ outputBySession: { ...get().outputBySession, [id]: output } })
    },
    setLastError: (id, lastError) => updateSession(id, { lastError })
  }
})
