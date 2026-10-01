import type * as Monaco from 'monaco-editor'
import { serverRequestFor } from './code-navigation-providers'
import type { CodeNavigationActivation } from './code-navigation-activation'

// Why: re-warming keeps a server up while someone works in the project; once a minute is plenty.
const WARM_INTERVAL_MS = 60_000

type WarmableModel = Parameters<typeof serverRequestFor>[0]

const lastWarmedAt = new Map<string, number>()

/**
 * Keeps an explicitly activated C# project warm while it is in use. Before activation this exits
 * without serializing the document or invoking IPC; installed servers may restart, but no server
 * is downloaded.
 */
export function prewarmCodeNavigation(
  model: WarmableModel,
  activation: CodeNavigationActivation,
  now: number = Date.now()
): void {
  const api = window.api?.codeNavigation
  const request = serverRequestFor(model, { lineNumber: 1, column: 1 }, activation)
  // Why C# only: a TypeScript server answers its first jump in about a second anyway.
  if (!api || !request || request.kind !== 'csharp') {
    return
  }
  const key = `${request.kind}\0${request.root}`
  if (now - (lastWarmedAt.get(key) ?? Number.NEGATIVE_INFINITY) < WARM_INTERVAL_MS) {
    return
  }
  lastWarmedAt.set(key, now)
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
