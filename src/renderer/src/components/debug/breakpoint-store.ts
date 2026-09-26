import { create } from 'zustand'
import type { DebugProtocol } from '@vscode/debugprotocol'

const STORAGE_KEY = 'orca.debug.breakpoints.v2'
const LEGACY_STORAGE_KEY = 'orca.debug.breakpoints.v1'
const EXCEPTION_FILTERS_STORAGE_KEY = 'orca.debug.exceptionFilters.v1'

export type BreakpointSpec = {
  line: number
  enabled: boolean
  /** Pause only when this expression is true. */
  condition?: string
  /** Pause only on matching hit counts, e.g. "3" or ">= 5" (adapter-specific syntax). */
  hitCondition?: string
  /** Log this message instead of pausing (a logpoint); `{expr}` is evaluated. */
  logMessage?: string
}

export type BreakpointEdit = { path: string; line: number; x: number; y: number }

type BreakpointPatch = Partial<Omit<BreakpointSpec, 'line'>>

export function toggleBreakpointSpec(
  specs: readonly BreakpointSpec[],
  line: number
): BreakpointSpec[] {
  return specs.some((spec) => spec.line === line)
    ? specs.filter((spec) => spec.line !== line)
    : [...specs, { line, enabled: true }].sort((a, b) => a.line - b.line)
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function patchBreakpointSpec(spec: BreakpointSpec, patch: BreakpointPatch): BreakpointSpec {
  const next = { ...spec, ...patch }
  const condition = cleanText(next.condition)
  const hitCondition = cleanText(next.hitCondition)
  const logMessage = cleanText(next.logMessage)
  return {
    line: next.line,
    enabled: next.enabled,
    ...(condition ? { condition } : {}),
    ...(hitCondition ? { hitCondition } : {}),
    ...(logMessage ? { logMessage } : {})
  }
}

/** What the adapter receives: enabled breakpoints only, without empty fields. */
export function toSourceBreakpoints(
  specs: readonly BreakpointSpec[]
): DebugProtocol.SourceBreakpoint[] {
  return specs
    .filter((spec) => spec.enabled)
    .map(({ line, condition, hitCondition, logMessage }) => ({
      line,
      ...(condition ? { condition } : {}),
      ...(hitCondition ? { hitCondition } : {}),
      ...(logMessage ? { logMessage } : {})
    }))
}

function readSpec(value: unknown): BreakpointSpec | null {
  if (typeof value === 'number') {
    // v1 stored bare line numbers.
    return Number.isInteger(value) && value > 0 ? { line: value, enabled: true } : null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record: Record<string, unknown> = { ...value }
  if (typeof record.line !== 'number' || !Number.isInteger(record.line) || record.line <= 0) {
    return null
  }
  return patchBreakpointSpec(
    { line: record.line, enabled: record.enabled !== false },
    {
      condition: typeof record.condition === 'string' ? record.condition : undefined,
      hitCondition: typeof record.hitCondition === 'string' ? record.hitCondition : undefined,
      logMessage: typeof record.logMessage === 'string' ? record.logMessage : undefined
    }
  )
}

function readStorage(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the state then lasts only for this window.
  }
}

export function readPersistedBreakpoints(): Record<string, BreakpointSpec[]> {
  const value = readStorage(STORAGE_KEY) ?? readStorage(LEGACY_STORAGE_KEY)
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const result: Record<string, BreakpointSpec[]> = {}
  for (const [path, specs] of Object.entries(value)) {
    if (Array.isArray(specs)) {
      const valid = specs.flatMap((spec) => readSpec(spec) ?? [])
      if (valid.length > 0) {
        result[path] = valid.sort((a, b) => a.line - b.line)
      }
    }
  }
  return result
}

function readExceptionFilters(): Record<string, string[]> {
  const value = readStorage(EXCEPTION_FILTERS_STORAGE_KEY)
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([adapterId, filters]) =>
      Array.isArray(filters)
        ? [[adapterId, filters.filter((filter): filter is string => typeof filter === 'string')]]
        : []
    )
  )
}

type BreakpointState = {
  breakpointsByFile: Record<string, BreakpointSpec[]>
  /** file → line → whether the running adapter bound it; empty while no session runs. */
  verifiedByFile: Record<string, Record<number, boolean>>
  /** adapterId → exception filters the user turned on (unset: the adapter's defaults). */
  exceptionFiltersByAdapter: Record<string, string[]>
  editing: BreakpointEdit | null
  toggle: (path: string, line: number) => BreakpointSpec[]
  update: (path: string, line: number, patch: BreakpointPatch) => BreakpointSpec[]
  remove: (path: string, line: number) => BreakpointSpec[]
  setVerified: (path: string, verified: Record<number, boolean>) => void
  clearVerified: () => void
  setExceptionFilters: (adapterId: string, filters: string[]) => void
  openEditor: (edit: BreakpointEdit) => void
  closeEditor: () => void
}

export const useBreakpointStore = create<BreakpointState>((set, get) => {
  const commit = (path: string, specs: BreakpointSpec[]): BreakpointSpec[] => {
    const { [path]: _removed, ...rest } = get().breakpointsByFile
    const breakpointsByFile = specs.length > 0 ? { ...rest, [path]: specs } : rest
    set({ breakpointsByFile })
    writeStorage(STORAGE_KEY, breakpointsByFile)
    return specs
  }
  return {
    breakpointsByFile: readPersistedBreakpoints(),
    verifiedByFile: {},
    exceptionFiltersByAdapter: readExceptionFilters(),
    editing: null,
    toggle: (path, line) =>
      commit(path, toggleBreakpointSpec(get().breakpointsByFile[path] ?? [], line)),
    update: (path, line, patch) =>
      commit(
        path,
        (get().breakpointsByFile[path] ?? []).map((spec) =>
          spec.line === line ? patchBreakpointSpec(spec, patch) : spec
        )
      ),
    remove: (path, line) =>
      commit(
        path,
        (get().breakpointsByFile[path] ?? []).filter((spec) => spec.line !== line)
      ),
    setVerified: (path, verified) =>
      set({ verifiedByFile: { ...get().verifiedByFile, [path]: verified } }),
    clearVerified: () => set({ verifiedByFile: {} }),
    setExceptionFilters: (adapterId, filters) => {
      const exceptionFiltersByAdapter = { ...get().exceptionFiltersByAdapter, [adapterId]: filters }
      set({ exceptionFiltersByAdapter })
      writeStorage(EXCEPTION_FILTERS_STORAGE_KEY, exceptionFiltersByAdapter)
    },
    openEditor: (editing) => set({ editing }),
    closeEditor: () => set({ editing: null })
  }
})
