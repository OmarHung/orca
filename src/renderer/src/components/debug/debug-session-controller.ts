import type {
  DebugLaunchOptions,
  DebugLaunchTarget,
  DebugSessionEvent
} from '../../../../shared/debug/debug-session-types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { useBottomPanelLayout } from '../bottom-panel/bottom-panel-layout-store'
import { revealDebugLocation } from './debug-editor-navigation'
import {
  readOutputEvent,
  readScopes,
  readStackFrames,
  readStoppedEvent,
  readThreadIds,
  readVariables
} from './debug-protocol-readers'
import { findDebugSession, useDebugStore } from './debug-store'
import { useBreakpointStore } from './breakpoint-store'
import { useWatchStore } from './watch-store'
import {
  adapterIdForTarget,
  applyBreakpointEvent,
  breakpointsForRequest,
  syncSessionBreakpoints
} from './breakpoint-sync'
import { dapRequest, isLiveSessionId, reportDebugError } from './debug-request'
import { refreshWatches } from './debug-evaluate'

const STACK_DEPTH = 64

let unsubscribeEvents: (() => void) | null = null

export async function loadDebugVariables(
  sessionId: string,
  variablesReference: number
): Promise<void> {
  if (variablesReference <= 0) {
    return
  }
  try {
    const body = await dapRequest(sessionId, 'variables', { variablesReference })
    useDebugStore.getState().setVariables(sessionId, variablesReference, readVariables(body))
  } catch (error) {
    reportDebugError(sessionId, error)
  }
}

export async function selectDebugFrame(sessionId: string, frameId: number): Promise<void> {
  const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
  const frame = session?.frames.find((candidate) => candidate.id === frameId)
  if (!session || !frame) {
    return
  }
  try {
    const scopes = readScopes(await dapRequest(sessionId, 'scopes', { frameId }))
    const path = frame.source?.path
    const executionLocation = path ? { path, line: frame.line } : null
    useDebugStore.getState().setPausedState(sessionId, {
      frames: session.frames,
      selectedFrameId: frameId,
      scopes,
      executionLocation
    })
    if (executionLocation) {
      revealDebugLocation(session.worktreeId, executionLocation.path, executionLocation.line)
    }
    const firstCheapScope = scopes.find((scope) => !scope.expensive)
    await Promise.all([
      firstCheapScope ? loadDebugVariables(sessionId, firstCheapScope.variablesReference) : null,
      refreshWatches(sessionId)
    ])
  } catch (error) {
    reportDebugError(sessionId, error)
  }
}

/** Forgets a session's paused state once its program runs again. */
export function markDebugSessionRunning(sessionId: string): void {
  useDebugStore.getState().clearPausedState(sessionId)
  useWatchStore.getState().setResults(sessionId, {})
  useDebugStore.getState().updateSession(sessionId, { stoppedThreadId: null, stopReason: null })
}

async function handleStopped(sessionId: string, body: unknown): Promise<void> {
  const stopped = readStoppedEvent(body)
  if (!stopped) {
    return
  }
  try {
    const threadId =
      stopped.threadId ?? readThreadIds(await dapRequest(sessionId, 'threads'))[0] ?? null
    const store = useDebugStore.getState()
    store.updateSession(sessionId, { stoppedThreadId: threadId, stopReason: stopped.reason })
    if (threadId === null) {
      return
    }
    const frames = readStackFrames(
      await dapRequest(sessionId, 'stackTrace', { threadId, startFrame: 0, levels: STACK_DEPTH })
    )
    store.setPausedState(sessionId, {
      frames,
      selectedFrameId: null,
      scopes: [],
      executionLocation: null
    })
    // JetBrains brings the session that just paused to the front of the Debug window.
    const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
    if (session) {
      store.selectSession(session.worktreeId, sessionId)
    }
    const topFrame = frames.find((frame) => frame.source?.path) ?? frames[0]
    if (topFrame) {
      await selectDebugFrame(sessionId, topFrame.id)
    }
  } catch (error) {
    reportDebugError(sessionId, error)
  }
}

function handlePhase(sessionId: string, event: Extract<DebugSessionEvent, { kind: 'phase' }>) {
  const store = useDebugStore.getState()
  store.updateSession(sessionId, { phase: event.phase })
  if (event.phase === 'running') {
    void syncSessionBreakpoints(sessionId)
  }
  if (event.message) {
    store.appendOutput(sessionId, 'orca', `${event.message}\n`)
  }
  if (event.phase === 'ended') {
    markDebugSessionRunning(sessionId)
    store.updateSession(sessionId, { verifiedByFile: {} })
  }
}

function handleEvent(event: DebugSessionEvent): void {
  const store = useDebugStore.getState()
  const sessionId = findDebugSession(store.sessions, event.sessionId)?.id
  if (!sessionId) {
    return
  }
  if (event.kind === 'capabilities') {
    store.updateSession(sessionId, { exceptionFilters: event.exceptionFilters })
    return
  }
  if (event.kind === 'phase') {
    handlePhase(sessionId, event)
    return
  }
  const { event: name, body } = event.event
  if (name === 'stopped') {
    void handleStopped(sessionId, body)
  } else if (name === 'continued') {
    markDebugSessionRunning(sessionId)
  } else if (name === 'breakpoint') {
    applyBreakpointEvent(sessionId, body)
  } else if (name === 'output') {
    const output = readOutputEvent(body)
    if (output) {
      store.appendOutput(sessionId, output.category, output.text)
    }
  }
}

function ensureEventSubscription(): void {
  unsubscribeEvents ??= window.api.debug.onEvent(handleEvent)
}

export async function stopDebugSession(sessionId: string): Promise<void> {
  if (isLiveSessionId(sessionId)) {
    await window.api.debug.stop(sessionId)
  }
}

/** Closes a session's tab, stopping its program first if it still runs. */
export async function closeDebugSession(sessionId: string): Promise<void> {
  await stopDebugSession(sessionId)
  useWatchStore.getState().setResults(sessionId, {})
  useDebugStore.getState().removeSession(sessionId)
}

/** Debugging the same thing again restarts it in a fresh tab, as JetBrains reuses the tab. */
async function closeSameSession(worktreeId: string, identity: string): Promise<void> {
  const previous = useDebugStore
    .getState()
    .sessions.filter(
      (session) => session.worktreeId === worktreeId && session.identity === identity
    )
  await Promise.all(previous.map((session) => closeDebugSession(session.id)))
}

export async function startDebugSession(options: {
  worktreeId: string
  cwd: string
  title: string
  target: DebugLaunchTarget
  launchOptions?: DebugLaunchOptions
  sourceKey?: string
}): Promise<void> {
  ensureEventSubscription()
  const identity = options.sourceKey ?? JSON.stringify(options.target)
  await closeSameSession(options.worktreeId, identity)
  const sessionId = createBrowserUuid()
  const adapterId = adapterIdForTarget(options.target)
  const worktree = findWorktreeById(useAppStore.getState().worktreesByRepo, options.worktreeId)
  const rootPath = worktree?.path ?? options.cwd
  useDebugStore.getState().addSession({
    id: sessionId,
    worktreeId: options.worktreeId,
    title: options.title,
    ...(options.sourceKey ? { sourceKey: options.sourceKey } : {}),
    identity,
    adapterId,
    rootPath
  })
  useBottomPanelLayout.getState().showTab('debug')
  const exceptionFilters = useBreakpointStore.getState().exceptionFiltersByAdapter[adapterId]
  const result = await window.api.debug.start(sessionId, {
    worktreeId: options.worktreeId,
    cwd: options.cwd,
    breakpoints: breakpointsForRequest({ rootPath, adapterId }),
    target: options.target,
    ...(exceptionFilters ? { exceptionFilters } : {}),
    ...(options.launchOptions ? { launchOptions: options.launchOptions } : {})
  })
  const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
  // Why: failures before the adapter starts (e.g. no Python found) emit no `ended` event.
  if (!result.ok && session && session.phase !== 'ended') {
    useDebugStore.getState().updateSession(sessionId, { phase: 'ended' })
    useDebugStore.getState().appendOutput(sessionId, 'orca', `${result.message}\n`)
  }
}
