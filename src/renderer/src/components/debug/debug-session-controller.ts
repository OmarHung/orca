import type {
  DebugLaunchOptions,
  DebugLaunchTarget,
  DebugSessionEvent
} from '../../../../shared/debug/debug-session-types'
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
import { useDebugStore } from './debug-store'
import { useBreakpointStore } from './breakpoint-store'
import { useWatchStore } from './watch-store'
import {
  adapterIdForTarget,
  applyBreakpointEvent,
  breakpointsForRequest,
  syncAllBreakpoints
} from './breakpoint-sync'
import { currentSessionId, dapRequest, reportDebugError } from './debug-request'
import { refreshWatches } from './debug-evaluate'

const STACK_DEPTH = 64

let unsubscribeEvents: (() => void) | null = null

export async function loadDebugVariables(variablesReference: number): Promise<void> {
  if (variablesReference <= 0) {
    return
  }
  try {
    const body = await dapRequest('variables', { variablesReference })
    useDebugStore.getState().setVariables(variablesReference, readVariables(body))
  } catch (error) {
    reportDebugError(error)
  }
}

export async function selectDebugFrame(frameId: number): Promise<void> {
  const store = useDebugStore.getState()
  const frame = store.frames.find((candidate) => candidate.id === frameId)
  if (!frame) {
    return
  }
  try {
    const scopes = readScopes(await dapRequest('scopes', { frameId }))
    const path = frame.source?.path
    const executionLocation = path ? { path, line: frame.line } : null
    useDebugStore.getState().setPausedState({
      frames: store.frames,
      selectedFrameId: frameId,
      scopes,
      executionLocation
    })
    const session = useDebugStore.getState().session
    if (session && executionLocation) {
      revealDebugLocation(session.worktreeId, executionLocation.path, executionLocation.line)
    }
    const firstCheapScope = scopes.find((scope) => !scope.expensive)
    await Promise.all([
      firstCheapScope ? loadDebugVariables(firstCheapScope.variablesReference) : null,
      refreshWatches()
    ])
  } catch (error) {
    reportDebugError(error)
  }
}

async function handleStopped(body: unknown): Promise<void> {
  const stopped = readStoppedEvent(body)
  if (!stopped) {
    return
  }
  try {
    const threadId = stopped.threadId ?? readThreadIds(await dapRequest('threads'))[0] ?? null
    useDebugStore
      .getState()
      .updateSession({ stoppedThreadId: threadId, stopReason: stopped.reason })
    if (threadId === null) {
      return
    }
    const frames = readStackFrames(
      await dapRequest('stackTrace', { threadId, startFrame: 0, levels: STACK_DEPTH })
    )
    useDebugStore
      .getState()
      .setPausedState({ frames, selectedFrameId: null, scopes: [], executionLocation: null })
    const topFrame = frames.find((frame) => frame.source?.path) ?? frames[0]
    if (topFrame) {
      await selectDebugFrame(topFrame.id)
    }
  } catch (error) {
    reportDebugError(error)
  }
}

function handleEvent(event: DebugSessionEvent): void {
  const store = useDebugStore.getState()
  if (store.session?.id !== event.sessionId) {
    return
  }
  if (event.kind === 'capabilities') {
    store.setExceptionFilterOptions(event.adapterId, event.exceptionFilters)
    return
  }
  if (event.kind === 'phase') {
    store.updateSession({ phase: event.phase })
    if (event.phase === 'running') {
      void syncAllBreakpoints()
    }
    if (event.message) {
      store.appendOutput('orca', `${event.message}\n`)
    }
    if (event.phase === 'ended') {
      useBreakpointStore.getState().clearVerified()
      useWatchStore.getState().setResults({})
      store.clearPausedState()
      store.updateSession({ stoppedThreadId: null, stopReason: null })
    }
    return
  }
  const { event: name, body } = event.event
  if (name === 'stopped') {
    void handleStopped(body)
  } else if (name === 'continued') {
    store.clearPausedState()
    useWatchStore.getState().setResults({})
    store.updateSession({ stoppedThreadId: null, stopReason: null })
  } else if (name === 'breakpoint') {
    applyBreakpointEvent(body)
  } else if (name === 'output') {
    const output = readOutputEvent(body)
    if (output) {
      store.appendOutput(output.category, output.text)
    }
  }
}

function ensureEventSubscription(): void {
  unsubscribeEvents ??= window.api.debug.onEvent(handleEvent)
}

export async function startDebugSession(options: {
  worktreeId: string
  cwd: string
  title: string
  target: DebugLaunchTarget
  launchOptions?: DebugLaunchOptions
  sourceKey?: string
}): Promise<void> {
  if (currentSessionId()) {
    await stopDebugSession()
  }
  ensureEventSubscription()
  const sessionId = crypto.randomUUID()
  useDebugStore.getState().setSession({
    id: sessionId,
    worktreeId: options.worktreeId,
    title: options.title,
    ...(options.sourceKey ? { sourceKey: options.sourceKey } : {}),
    phase: 'starting',
    stoppedThreadId: null,
    stopReason: null
  })
  useBottomPanelLayout.getState().showTab('debug')
  const exceptionFilters =
    useBreakpointStore.getState().exceptionFiltersByAdapter[adapterIdForTarget(options.target)]
  const result = await window.api.debug.start(sessionId, {
    worktreeId: options.worktreeId,
    cwd: options.cwd,
    breakpoints: breakpointsForRequest(),
    target: options.target,
    ...(exceptionFilters ? { exceptionFilters } : {}),
    ...(options.launchOptions ? { launchOptions: options.launchOptions } : {})
  })
  const session = useDebugStore.getState().session
  // Why: failures before the adapter starts (e.g. no Python found) emit no `ended` event.
  if (!result.ok && session?.id === sessionId && session.phase !== 'ended') {
    useDebugStore.getState().updateSession({ phase: 'ended' })
    useDebugStore.getState().appendOutput('orca', `${result.message}\n`)
  }
}

export async function stopDebugSession(): Promise<void> {
  const sessionId = currentSessionId()
  if (sessionId) {
    await window.api.debug.stop(sessionId)
  }
}

function threadCommand(command: 'continue' | 'next' | 'stepIn' | 'stepOut'): void {
  const threadId = useDebugStore.getState().session?.stoppedThreadId
  if (threadId === null || threadId === undefined) {
    return
  }
  useDebugStore.getState().clearPausedState()
  useWatchStore.getState().setResults({})
  useDebugStore.getState().updateSession({ stoppedThreadId: null, stopReason: null })
  dapRequest(command, { threadId }).catch(reportDebugError)
}

export const debugContinue = (): void => threadCommand('continue')
export const debugStepOver = (): void => threadCommand('next')
export const debugStepInto = (): void => threadCommand('stepIn')
export const debugStepOut = (): void => threadCommand('stepOut')

export async function debugPause(): Promise<void> {
  try {
    const threadId = readThreadIds(await dapRequest('threads'))[0]
    if (threadId !== undefined) {
      await dapRequest('pause', { threadId })
    }
  } catch (error) {
    reportDebugError(error)
  }
}
