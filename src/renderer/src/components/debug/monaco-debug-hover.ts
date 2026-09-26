import * as monaco from 'monaco-editor'
import { toEditorModelUri } from '../editor/editor-model-uri'
import { evaluateExpression } from './debug-evaluate'
import { hoverExpressionAt } from './debug-hover-expression'
import { useDebugStore } from './debug-store'

const registeredLanguages = new Set<string>()

async function provideDebugHover(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken
): Promise<monaco.languages.Hover | null> {
  const state = useDebugStore.getState()
  const location = state.executionLocation
  // Why only the paused file: evaluating names from another file would show unrelated values.
  if (
    !location ||
    state.session?.stoppedThreadId == null ||
    model.uri.toString() !== toEditorModelUri(location.path)
  ) {
    return null
  }
  const expression = hoverExpressionAt(model.getLineContent(position.lineNumber), position.column)
  if (!expression) {
    return null
  }
  try {
    const result = await evaluateExpression(expression, 'hover')
    if (token.isCancellationRequested) {
      return null
    }
    const type = result.type ? ` (${result.type})` : ''
    return { contents: [{ value: `\`${expression}\`${type} = \`${result.value}\`` }] }
  } catch {
    // Not every word is an expression (keywords, out-of-scope names); show nothing.
    return null
  }
}

/** Shows variable values on hover while paused; registered once per language. */
export function ensureDebugHoverProvider(language: string): void {
  if (registeredLanguages.has(language)) {
    return
  }
  registeredLanguages.add(language)
  monaco.languages.registerHoverProvider(language, { provideHover: provideDebugHover })
}
