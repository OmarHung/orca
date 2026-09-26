const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

/**
 * The expression to evaluate for a hover at `column` (1-based): the identifier under the
 * cursor plus any `a.b.` chain to its left, so hovering `total` in `self.total` shows the field.
 */
export function hoverExpressionAt(lineText: string, column: number): string | null {
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
  return /^[0-9]/.test(expression) ? null : expression
}
