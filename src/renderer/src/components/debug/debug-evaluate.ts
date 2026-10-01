import { readEvaluateResult, type EvaluateResult } from './debug-protocol-readers'
import { dapRequest, isLiveSessionId } from './debug-request'
import { findDebugSession, useDebugStore } from './debug-store'
import { useWatchStore, type WatchResult } from './watch-store'

export type EvaluateContext = 'watch' | 'repl' | 'hover'

function selectedFrameId(sessionId: string): number | null {
  return findDebugSession(useDebugStore.getState().sessions, sessionId)?.selectedFrameId ?? null
}

/** Evaluates in the session's selected frame (when paused); throws with the adapter's message. */
export async function evaluateExpression(
  sessionId: string,
  expression: string,
  context: EvaluateContext
): Promise<EvaluateResult> {
  const frameId = selectedFrameId(sessionId)
  const body = await dapRequest(sessionId, 'evaluate', {
    expression,
    context,
    ...(frameId !== null ? { frameId } : {})
  })
  const result = readEvaluateResult(body)
  if (!result) {
    throw new Error('The debugger returned no value')
  }
  return result
}

/** Re-evaluates every watch against the session's selected frame; clears them unless paused. */
export async function refreshWatches(sessionId: string): Promise<void> {
  const store = useWatchStore.getState()
  if (!isLiveSessionId(sessionId) || selectedFrameId(sessionId) === null) {
    store.setResults(sessionId, {})
    return
  }
  const entries = await Promise.all(
    store.expressions.map(async (expression): Promise<[string, WatchResult]> => {
      try {
        return [
          expression,
          { ok: true, result: await evaluateExpression(sessionId, expression, 'watch') }
        ]
      } catch (error) {
        return [
          expression,
          { ok: false, message: error instanceof Error ? error.message : String(error) }
        ]
      }
    })
  )
  useWatchStore.getState().setResults(sessionId, Object.fromEntries(entries))
}

/** Evaluates the watches in every paused session, e.g. after one was added. */
export async function refreshAllWatches(): Promise<void> {
  const paused = useDebugStore
    .getState()
    .sessions.filter((session) => session.selectedFrameId !== null)
  await Promise.all(paused.map((session) => refreshWatches(session.id)))
}

/** Runs a Debug console line, echoing it and its value (or error) into the session's console. */
export async function evaluateInConsole(sessionId: string, expression: string): Promise<void> {
  const trimmed = expression.trim()
  if (!trimmed) {
    return
  }
  const store = useDebugStore.getState()
  store.appendOutput(sessionId, 'orca', `> ${trimmed}\n`)
  try {
    const result = await evaluateExpression(sessionId, trimmed, 'repl')
    useDebugStore.getState().appendOutput(sessionId, 'stdout', `${result.value}\n`)
  } catch (error) {
    useDebugStore
      .getState()
      .appendOutput(
        sessionId,
        'stderr',
        `${error instanceof Error ? error.message : String(error)}\n`
      )
  }
}
