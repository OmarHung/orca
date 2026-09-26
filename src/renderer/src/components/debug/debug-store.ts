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

export type DebugSessionView = {
  id: string
  worktreeId: string
  /** What is being debugged, e.g. a file name or "web: dev". */
  title: string
  phase: DebugSessionPhase
  /** Set while paused; null while the program runs. */
  stoppedThreadId: number | null
  stopReason: string | null
}

type DebugState = {
  session: DebugSessionView | null
  /** Exception filters the running adapter offers; kept after it ends for the Breakpoints tab. */
  exceptionFilterOptions: { adapterId: string; filters: DebugExceptionFilter[] } | null
  frames: DebugProtocol.StackFrame[]
  selectedFrameId: number | null
  scopes: DebugProtocol.Scope[]
  /** variablesReference → children, loaded lazily as the tree expands. */
  variablesByReference: Record<number, DebugProtocol.Variable[]>
  executionLocation: DebugExecutionLocation | null
  output: DebugOutputEntry[]
  lastError: string | null
}

type DebugActions = {
  setExceptionFilterOptions: (adapterId: string, filters: DebugExceptionFilter[]) => void
  setSession: (session: DebugSessionView | null) => void
  updateSession: (patch: Partial<DebugSessionView>) => void
  setPausedState: (state: {
    frames: DebugProtocol.StackFrame[]
    selectedFrameId: number | null
    scopes: DebugProtocol.Scope[]
    executionLocation: DebugExecutionLocation | null
  }) => void
  setVariables: (reference: number, variables: DebugProtocol.Variable[]) => void
  clearPausedState: () => void
  appendOutput: (category: DebugOutputEntry['category'], text: string) => void
  setLastError: (message: string | null) => void
}

const EMPTY_PAUSED_STATE = {
  frames: [],
  selectedFrameId: null,
  scopes: [],
  variablesByReference: {},
  executionLocation: null
} satisfies Partial<DebugState>

let nextOutputId = 1

// Why a standalone store: debug state is per-window and transient, and keeping it out of
// the synced app store keeps this fork feature isolated from upstream store changes.
export const useDebugStore = create<DebugState & DebugActions>((set, get) => ({
  session: null,
  exceptionFilterOptions: null,
  ...EMPTY_PAUSED_STATE,
  output: [],
  lastError: null,
  setExceptionFilterOptions: (adapterId, filters) =>
    set({ exceptionFilterOptions: { adapterId, filters } }),
  setSession: (session) =>
    set(session ? { session, ...EMPTY_PAUSED_STATE, output: [], lastError: null } : { session }),
  updateSession: (patch) => {
    const current = get().session
    if (current) {
      set({ session: { ...current, ...patch } })
    }
  },
  setPausedState: (state) => set({ ...state, variablesByReference: {} }),
  setVariables: (reference, variables) =>
    set({ variablesByReference: { ...get().variablesByReference, [reference]: variables } }),
  clearPausedState: () => set(EMPTY_PAUSED_STATE),
  appendOutput: (category, text) => {
    const entry = { id: nextOutputId++, category, text }
    set({ output: [...get().output, entry].slice(-MAX_DEBUG_OUTPUT_ENTRIES) })
  },
  setLastError: (lastError) => set({ lastError })
}))
