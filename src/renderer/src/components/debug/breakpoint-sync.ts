import type { DebugLaunchTarget } from '../../../../shared/debug/debug-session-types'
import { toSourceBreakpoints, useBreakpointStore, type BreakpointSpec } from './breakpoint-store'
import { currentSessionId, dapRequest, reportDebugError } from './debug-request'
import { useDebugStore } from './debug-store'

type BreakpointPatch = Partial<Omit<BreakpointSpec, 'line'>>

/** The adapter a launch target uses; exception filter choices are remembered per adapter. */
export function adapterIdForTarget(target: DebugLaunchTarget): string {
  switch (target.kind) {
    case 'python-file':
      return 'debugpy'
    case 'node-file':
    case 'node-script':
      return 'pwa-node'
    case 'dotnet-project':
      return 'coreclr'
  }
}

export function breakpointsForRequest(): Record<string, ReturnType<typeof toSourceBreakpoints>> {
  return Object.fromEntries(
    Object.entries(useBreakpointStore.getState().breakpointsByFile).map(([path, specs]) => [
      path,
      toSourceBreakpoints(specs)
    ])
  )
}

/** Which of the sent breakpoints the adapter bound, keyed by line. */
export function readVerified(body: unknown, sentLines: readonly number[]): Record<number, boolean> {
  const list =
    typeof body === 'object' && body !== null && 'breakpoints' in body ? body.breakpoints : null
  if (!Array.isArray(list)) {
    return {}
  }
  const verified: Record<number, boolean> = {}
  sentLines.forEach((line, index) => {
    const entry: unknown = list[index]
    verified[line] =
      typeof entry === 'object' && entry !== null && 'verified' in entry
        ? entry.verified === true
        : false
  })
  return verified
}

/** Sends one file's breakpoints to the running session and records which ones bound. */
export async function syncFileBreakpoints(path: string): Promise<void> {
  if (!currentSessionId()) {
    return
  }
  const breakpoints = toSourceBreakpoints(
    useBreakpointStore.getState().breakpointsByFile[path] ?? []
  )
  try {
    const body = await dapRequest('setBreakpoints', { source: { path }, breakpoints })
    useBreakpointStore.getState().setVerified(
      path,
      readVerified(
        body,
        breakpoints.map((breakpoint) => breakpoint.line)
      )
    )
  } catch (error) {
    reportDebugError(error)
  }
}

/** Re-sends every file once the program runs, to learn which breakpoints bound. */
export async function syncAllBreakpoints(): Promise<void> {
  await Promise.all(
    Object.keys(useBreakpointStore.getState().breakpointsByFile).map(syncFileBreakpoints)
  )
}

/** Applies a DAP `breakpoint` event (an adapter binding a breakpoint later, e.g. js-debug). */
export function applyBreakpointEvent(body: unknown): void {
  const breakpoint =
    typeof body === 'object' && body !== null && 'breakpoint' in body ? body.breakpoint : null
  if (typeof breakpoint !== 'object' || breakpoint === null) {
    return
  }
  const record: Record<string, unknown> = { ...breakpoint }
  const source: Record<string, unknown> =
    typeof record.source === 'object' && record.source !== null ? { ...record.source } : {}
  if (typeof source.path !== 'string' || typeof record.line !== 'number') {
    return
  }
  const store = useBreakpointStore.getState()
  store.setVerified(source.path, {
    ...store.verifiedByFile[source.path],
    [record.line]: record.verified === true
  })
}

export function toggleDebugBreakpoint(path: string, line: number): void {
  useBreakpointStore.getState().toggle(path, line)
  void syncFileBreakpoints(path)
}

export function updateDebugBreakpoint(path: string, line: number, patch: BreakpointPatch): void {
  useBreakpointStore.getState().update(path, line, patch)
  void syncFileBreakpoints(path)
}

export function removeDebugBreakpoint(path: string, line: number): void {
  useBreakpointStore.getState().remove(path, line)
  void syncFileBreakpoints(path)
}

/** Saves the choice and applies it to a running session of the same adapter. */
export function setDebugExceptionFilters(adapterId: string, filters: string[]): void {
  useBreakpointStore.getState().setExceptionFilters(adapterId, filters)
  if (
    currentSessionId() &&
    useDebugStore.getState().exceptionFilterOptions?.adapterId === adapterId
  ) {
    dapRequest('setExceptionBreakpoints', { filters }).catch(reportDebugError)
  }
}
