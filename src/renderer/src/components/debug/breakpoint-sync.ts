import type { DebugLaunchTarget } from '../../../../shared/debug/debug-session-types'
import { toSourceBreakpoints, useBreakpointStore, type BreakpointSpec } from './breakpoint-store'
import {
  isInDebugScope,
  mergeVerifiedLines,
  type DebugBreakpointScope
} from './debug-breakpoint-scope'
import { dapRequest, reportDebugError } from './debug-request'
import {
  findDebugSession,
  isLiveDebugSession,
  useDebugStore,
  type DebugSession
} from './debug-store'

type BreakpointPatch = Partial<Omit<BreakpointSpec, 'line'>>

/** The adapter a launch target uses; exception filter choices are remembered per adapter. */
export function adapterIdForTarget(target: DebugLaunchTarget): string {
  switch (target.kind) {
    case 'python-file':
    case 'python-module':
      return 'debugpy'
    case 'node-file':
    case 'node-script':
      return 'pwa-node'
    case 'dotnet-project':
    case 'dotnet-program':
      return 'coreclr'
  }
}

/** The breakpoints a session takes at launch: its workspace's, in its adapter's languages. */
export function breakpointsForRequest(
  scope: DebugBreakpointScope
): Record<string, ReturnType<typeof toSourceBreakpoints>> {
  return Object.fromEntries(
    Object.entries(useBreakpointStore.getState().breakpointsByFile)
      .filter(([path]) => isInDebugScope(scope, path))
      .map(([path, specs]) => [path, toSourceBreakpoints(specs)])
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

/** line → bound for the gutter, over the live sessions that take `path`; undefined if none. */
export function verifiedLinesForFile(
  sessions: readonly DebugSession[],
  path: string
): Record<number, boolean> | undefined {
  return mergeVerifiedLines(
    sessions
      .filter((session) => isLiveDebugSession(session) && isInDebugScope(session, path))
      .map((session) => session.verifiedByFile[path])
  )
}

async function syncFileToSession(session: DebugSession, path: string): Promise<void> {
  const breakpoints = toSourceBreakpoints(
    useBreakpointStore.getState().breakpointsByFile[path] ?? []
  )
  try {
    const body = await dapRequest(session.id, 'setBreakpoints', { source: { path }, breakpoints })
    useDebugStore.getState().setVerified(
      session.id,
      path,
      readVerified(
        body,
        breakpoints.map((breakpoint) => breakpoint.line)
      )
    )
  } catch (error) {
    reportDebugError(session.id, error)
  }
}

/** Sends one file's breakpoints to every running session that takes it. */
export async function syncFileBreakpoints(path: string): Promise<void> {
  const sessions = useDebugStore
    .getState()
    .sessions.filter((session) => isLiveDebugSession(session) && isInDebugScope(session, path))
  await Promise.all(sessions.map((session) => syncFileToSession(session, path)))
}

/** Re-sends a session's files once its program runs, to learn which breakpoints bound. */
export async function syncSessionBreakpoints(sessionId: string): Promise<void> {
  const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
  if (!session) {
    return
  }
  const paths = Object.keys(useBreakpointStore.getState().breakpointsByFile)
  await Promise.all(
    paths
      .filter((path) => isInDebugScope(session, path))
      .map((path) => syncFileToSession(session, path))
  )
}

/** Applies a DAP `breakpoint` event (an adapter binding a breakpoint later, e.g. js-debug). */
export function applyBreakpointEvent(sessionId: string, body: unknown): void {
  const breakpoint =
    typeof body === 'object' && body !== null && 'breakpoint' in body ? body.breakpoint : null
  if (typeof breakpoint !== 'object' || breakpoint === null) {
    return
  }
  const record: Record<string, unknown> = { ...breakpoint }
  const source: Record<string, unknown> =
    typeof record.source === 'object' && record.source !== null ? { ...record.source } : {}
  const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
  if (!session || typeof source.path !== 'string' || typeof record.line !== 'number') {
    return
  }
  useDebugStore.getState().setVerified(sessionId, source.path, {
    ...session.verifiedByFile[source.path],
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

/** Saves the choice and applies it to every running session of that adapter. */
export function setDebugExceptionFilters(adapterId: string, filters: string[]): void {
  useBreakpointStore.getState().setExceptionFilters(adapterId, filters)
  for (const session of useDebugStore.getState().sessions) {
    if (isLiveDebugSession(session) && session.adapterId === adapterId) {
      dapRequest(session.id, 'setExceptionBreakpoints', { filters }).catch((error: unknown) =>
        reportDebugError(session.id, error)
      )
    }
  }
}
