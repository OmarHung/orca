import { readEvaluateResult, type EvaluateResult } from './debug-protocol-readers'
import { currentSessionId, dapRequest } from './debug-request'
import { useDebugStore } from './debug-store'
import { useWatchStore, type WatchResult } from './watch-store'

export type EvaluateContext = 'watch' | 'repl' | 'hover'

/** Evaluates in the selected frame (when paused); throws with the adapter's message. */
export async function evaluateExpression(
  expression: string,
  context: EvaluateContext
): Promise<EvaluateResult> {
  const frameId = useDebugStore.getState().selectedFrameId
  const body = await dapRequest('evaluate', {
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

/** Re-evaluates every watch against the selected frame; clears them when nothing is paused. */
export async function refreshWatches(): Promise<void> {
  const store = useWatchStore.getState()
  if (!currentSessionId() || useDebugStore.getState().selectedFrameId === null) {
    store.setResults({})
    return
  }
  const entries = await Promise.all(
    store.expressions.map(async (expression): Promise<[string, WatchResult]> => {
      try {
        return [expression, { ok: true, result: await evaluateExpression(expression, 'watch') }]
      } catch (error) {
        return [
          expression,
          { ok: false, message: error instanceof Error ? error.message : String(error) }
        ]
      }
    })
  )
  useWatchStore.getState().setResults(Object.fromEntries(entries))
}

/** Runs a Debug console line, echoing it and its value (or error) into the console. */
export async function evaluateInConsole(expression: string): Promise<void> {
  const trimmed = expression.trim()
  if (!trimmed) {
    return
  }
  const store = useDebugStore.getState()
  store.appendOutput('orca', `> ${trimmed}\n`)
  try {
    const result = await evaluateExpression(trimmed, 'repl')
    useDebugStore.getState().appendOutput('stdout', `${result.value}\n`)
  } catch (error) {
    useDebugStore
      .getState()
      .appendOutput('stderr', `${error instanceof Error ? error.message : String(error)}\n`)
  }
}
