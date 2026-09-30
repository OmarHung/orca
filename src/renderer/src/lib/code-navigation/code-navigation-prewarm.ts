import type * as Monaco from 'monaco-editor'
import { serverRequestFor } from './code-navigation-providers'

// Why: re-warming keeps a server up while someone works in the project; once a minute is plenty.
const WARM_INTERVAL_MS = 60_000

type WarmableModel = Parameters<typeof serverRequestFor>[0]

const lastWarmedAt = new Map<string, number>()

/**
 * Starts the C# server for this file's project in the background and has it compile, so the first
 * jump does not wait for the solution to load (over ten seconds on an x64 .NET under Rosetta).
 * Only installed servers start; nothing is downloaded.
 */
export function prewarmCodeNavigation(model: WarmableModel, now: number = Date.now()): void {
  const api = window.api?.codeNavigation
  const request = serverRequestFor(model, { lineNumber: 1, column: 1 })
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
export function installCodeNavigationPrewarm(monaco: Pick<typeof Monaco, 'editor'>): () => void {
  const created = monaco.editor.onDidCreateEditor((editor) => {
    const warm = (): void => {
      const model = editor.getModel()
      if (model) {
        prewarmCodeNavigation(model)
      }
    }
    editor.onDidChangeModel(warm)
    editor.onDidFocusEditorText(warm)
  })
  return () => created.dispose()
}
