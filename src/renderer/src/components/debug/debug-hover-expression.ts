const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

/** Longest selection evaluated on hover; longer ones are almost never a deliberate expression. */
const MAX_SELECTION_LENGTH = 500

/** An expression to evaluate and the 1-based columns it spans on its line (end exclusive). */
export type HoverExpression = { expression: string; startColumn: number; endColumn: number }

/**
 * The expression to evaluate for a hover at `column` (1-based): the identifier under the
 * cursor plus any `a.b.` chain to its left, so hovering `total` in `self.total` shows the field.
 */
export function hoverExpressionAt(lineText: string, column: number): HoverExpression | null {
  let start = column - 1
  let end = column - 1
  if (!IDENTIFIER_CHAR.test(lineText[start] ?? '')) {
    return null
  }
  while (start > 0 && IDENTIFIER_CHAR.test(lineText[start - 1])) {
    start--
  }
  while (end < lineText.length && IDENTIFIER_CHAR.test(lineText[end])) {
    end++
  }
  // Extend left over `.identifier` links (not `?.` or calls, which could run code).
  while (start > 1 && lineText[start - 1] === '.' && IDENTIFIER_CHAR.test(lineText[start - 2])) {
    start -= 1
    while (start > 0 && IDENTIFIER_CHAR.test(lineText[start - 1])) {
      start--
    }
  }
  const expression = lineText.slice(start, end)
  return /^[0-9]/.test(expression)
    ? null
    : { expression, startColumn: start + 1, endColumn: end + 1 }
}

/** A hovered single-line selection, evaluated as written (JetBrains' value-on-selection). */
export function selectionHoverExpression(
  selectedText: string,
  startColumn: number
): HoverExpression | null {
  const expression = selectedText.trim()
  if (!expression || expression.length > MAX_SELECTION_LENGTH || /[\r\n]/.test(selectedText)) {
    return null
  }
  return { expression, startColumn, endColumn: startColumn + selectedText.length }
}
