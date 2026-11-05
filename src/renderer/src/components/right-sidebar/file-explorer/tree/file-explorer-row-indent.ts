const INDENT_PER_DEPTH_PX = 16
const ROW_START_PADDING_PX = 8
/** Chevron, icon, and enough of the name to recognize the row. */
const REVEAL_VISIBLE_WIDTH_PX = 96

export function getFileExplorerRowIndent(depth: number, displayDepthOffset: number): number {
  return (depth - displayDepthOffset) * INDENT_PER_DEPTH_PX + ROW_START_PADDING_PX
}

/** Scrolls sideways so a revealed row's start shows; a row already in view stays put. */
export function scrollFileExplorerRowStartIntoView(
  scroller: Element | null,
  rowDepth: number | undefined,
  displayDepthOffset: number
): void {
  if (!scroller || rowDepth === undefined) {
    return
  }
  const rowIndent = getFileExplorerRowIndent(rowDepth, displayDepthOffset)
  const { scrollLeft, clientWidth } = scroller
  const startsInView =
    rowIndent >= scrollLeft && rowIndent + REVEAL_VISIBLE_WIDTH_PX <= scrollLeft + clientWidth
  if (!startsInView) {
    scroller.scrollLeft = Math.max(0, rowIndent - ROW_START_PADDING_PX)
  }
}
