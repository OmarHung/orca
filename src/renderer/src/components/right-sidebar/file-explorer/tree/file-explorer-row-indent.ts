const INDENT_PER_DEPTH_PX = 16
const ROW_START_PADDING_PX = 8
/** Chevron, icon, and enough of the name to recognize the row. */
const REVEAL_VISIBLE_WIDTH_PX = 96

export function getFileExplorerRowIndent(depth: number, displayDepthOffset: number): number {
  return (depth - displayDepthOffset) * INDENT_PER_DEPTH_PX + ROW_START_PADDING_PX
}

/** Where to scroll sideways so a revealed row's start shows; a row already in view stays put. */
export function getFileExplorerRevealScrollLeft(
  rowIndent: number,
  scrollLeft: number,
  clientWidth: number
): number {
  const startsInView =
    rowIndent >= scrollLeft && rowIndent + REVEAL_VISIBLE_WIDTH_PX <= scrollLeft + clientWidth
  return startsInView ? scrollLeft : Math.max(0, rowIndent - ROW_START_PADDING_PX)
}
