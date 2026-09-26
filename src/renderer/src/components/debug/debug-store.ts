import { create } from 'zustand'
import type { DebugProtocol } from '@vscode/debugprotocol'
import type { DebugSessionPhase } from '../../../../shared/debug/debug-session-types'

const BREAKPOINTS_STORAGE_KEY = 'orca.debug.breakpoints.v1'
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
  /** Absolute file path → sorted 1-based line numbers. */
  breakpointsByFile: Record<string, number[]>
  session: DebugSessionView | null
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
  toggleBreakpoint: (path: string, line: number) => number[]
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

function readPersistedBreakpoints(): Record<string, number[]> {
  try {
    const raw = window.localStorage.getItem(BREAKPOINTS_STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (typeof value !== 'object' || value === null) {
      return {}
    }
    const result: Record<string, number[]> = {}
    for (const [path, lines] of Object.entries(value)) {
      if (Array.isArray(lines)) {
        const valid = lines.filter((line): line is number => Number.isInteger(line) && line > 0)
        if (valid.length > 0) {
          result[path] = valid
        }
      }
    }
    return result
  } catch {
    return {}
  }
}

function writePersistedBreakpoints(breakpointsByFile: Record<string, number[]>): void {
  try {
    window.localStorage.setItem(BREAKPOINTS_STORAGE_KEY, JSON.stringify(breakpointsByFile))
  } catch {
    // Storage can be unavailable; breakpoints then last only for this window's lifetime.
  }
}

export function toggleLine(lines: readonly number[], line: number): number[] {
  return lines.includes(line)
    ? lines.filter((existing) => existing !== line)
    : [...lines, line].sort((a, b) => a - b)
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
  breakpointsByFile: readPersistedBreakpoints(),
  session: null,
  ...EMPTY_PAUSED_STATE,
  output: [],
  lastError: null,
  toggleBreakpoint: (path, line) => {
    const nextLines = toggleLine(get().breakpointsByFile[path] ?? [], line)
    const { [path]: _removed, ...rest } = get().breakpointsByFile
    const breakpointsByFile = nextLines.length > 0 ? { ...rest, [path]: nextLines } : rest
    set({ breakpointsByFile })
    writePersistedBreakpoints(breakpointsByFile)
    return nextLines
  },
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
