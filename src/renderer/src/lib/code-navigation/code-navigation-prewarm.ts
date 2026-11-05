import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { serverRequestFor } from './code-navigation-providers'
import { resolveCodeNavigationContext } from './code-navigation-workspace'
import type { CodeNavigationActivation } from './code-navigation-activation'

// Why: re-warming keeps a server up while someone works in the project; once a minute is plenty.
const WARM_INTERVAL_MS = 60_000

type WarmableModel = Parameters<typeof serverRequestFor>[0]

const lastWarmedAt = new Map<string, number>()

/**
 * Loads the language server as soon as a file of its project shows, so the first jump does not wait.
 * Main starts only an installed server; a missing one is still downloaded by the first explicit jump.
 */
export function prewarmCodeNavigation(
  model: WarmableModel,
  activation: CodeNavigationActivation,
  now: number = Date.now()
): void {
  const api = window.api?.codeNavigation
  const context = resolveCodeNavigationContext(useAppStore.getState(), model.uri.toString())
  if (!api || !context) {
    return
  }
  // Why before building the request: it copies the whole document, and this runs on every focus.
  const key = `${context.kind}\0${context.root}`
  if (now - (lastWarmedAt.get(key) ?? Number.NEGATIVE_INFINITY) < WARM_INTERVAL_MS) {
    return
  }
  const request = serverRequestFor(model, { lineNumber: 1, column: 1 })
  if (!request) {
    return
  }
  lastWarmedAt.set(key, now)
  activation.activateWorkspace(request.kind, request.root)
  void api.warm({ kind: request.kind, root: request.root, document: request.document })
}

/** Warms when an editor shows a file (model change) and when it takes focus. */
export function installCodeNavigationPrewarm(
  monaco: Pick<typeof Monaco, 'editor'>,
  activation: CodeNavigationActivation
): () => void {
  const created = monaco.editor.onDidCreateEditor((editor) => {
    const warm = (): void => {
      const model = editor.getModel()
      if (model) {
        prewarmCodeNavigation(model, activation)
      }
    }
    editor.onDidChangeModel(warm)
    editor.onDidFocusEditorText(warm)
  })
  return () => created.dispose()
}
