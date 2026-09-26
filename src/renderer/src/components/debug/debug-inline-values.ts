import type { DebugProtocol } from '@vscode/debugprotocol'

/** How far above the paused line to annotate; roughly one function body. */
const LOOKBACK_LINES = 40
const MAX_VALUE_CHARS = 40
const MAX_HINT_CHARS = 120
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export type InlineValueHint = { line: number; text: string }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function shorten(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

/**
 * JetBrains-style inline values: for each line up to the paused one, the locals it mentions
 * with their current values, e.g. `total = 6, i = 4`.
 */
export function buildInlineValueHints(
  lineAt: (line: number) => string,
  executionLine: number,
  variables: readonly DebugProtocol.Variable[]
): InlineValueHint[] {
  // Why identifiers only: debugpy groups like "special variables" are not source names.
  const named = variables
    .filter((variable) => IDENTIFIER.test(variable.name))
    .map((variable) => ({
      variable,
      pattern: new RegExp(`(^|[^\\w$.])${escapeRegExp(variable.name)}(?![\\w$])`)
    }))
  const hints: InlineValueHint[] = []
  for (let line = Math.max(1, executionLine - LOOKBACK_LINES); line <= executionLine; line++) {
    const text = lineAt(line)
    const parts = named
      .filter(({ pattern }) => pattern.test(text))
      .map(({ variable }) => `${variable.name} = ${shorten(variable.value, MAX_VALUE_CHARS)}`)
    if (parts.length > 0) {
      hints.push({ line, text: shorten(parts.join(', '), MAX_HINT_CHARS) })
    }
  }
  return hints
}
