export type DiffChangeDirection = 'next' | 'previous'

export type DiffChangeCursorEditor = {
  getPosition: () => { lineNumber: number; column: number } | null
  setPosition: (position: { lineNumber: number; column: number }) => void
  getScrollTop: () => number
  setScrollTop: (scrollTop: number) => void
}

export type DiffChangeStepTarget = {
  goToDiff: (direction: DiffChangeDirection) => void
  getModifiedEditor?: () => DiffChangeCursorEditor
}

// Why: Monaco's goToDiff wraps silently to the first or last change. Comparing the
// cursor before and after reuses Monaco's own rules instead of re-deriving them.
export function didDiffChangeStepWrap(
  direction: DiffChangeDirection,
  fromLine: number,
  toLine: number
): boolean {
  return direction === 'next' ? toLine <= fromLine : toLine >= fromLine
}

// Why: a target without a cursor (change-marker navigation) keeps the plain goToDiff path.
export function stepDiffChange(
  target: DiffChangeStepTarget,
  direction: DiffChangeDirection
): 'moved' | 'wrapped' {
  const modified = target.getModifiedEditor?.()
  if (!modified) {
    target.goToDiff(direction)
    return 'moved'
  }
  const before = modified.getPosition()
  const scrollTop = modified.getScrollTop()
  target.goToDiff(direction)
  const after = modified.getPosition()
  if (!before || !after || !didDiffChangeStepWrap(direction, before.lineNumber, after.lineNumber)) {
    return 'moved'
  }
  // Why: undo the wrap so the view stays on the last or first change until the next press.
  modified.setPosition(before)
  modified.setScrollTop(scrollTop)
  return 'wrapped'
}
