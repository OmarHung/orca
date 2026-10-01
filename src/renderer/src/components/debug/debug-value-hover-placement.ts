/** Keeps the popup this far from the window edges. */
const VIEWPORT_MARGIN_PX = 8
/** Tallest the popup grows before it scrolls, like JetBrains' value tree popup. */
export const MAX_POPUP_HEIGHT_PX = 320

/** The hovered text's box in window coordinates. */
export type HoverAnchor = { left: number; top: number; bottom: number }

export type PopupPlacement = { left: number; top: number; maxHeight: number }

/**
 * Where to put a value popup of `size` for `anchor`: under the text when it fits, else on the
 * side with more room (capped there, so it scrolls instead of leaving the window).
 */
export function placeValuePopup(
  anchor: HoverAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): PopupPlacement {
  const spaceBelow = viewport.height - anchor.bottom - VIEWPORT_MARGIN_PX
  const spaceAbove = anchor.top - VIEWPORT_MARGIN_PX
  const wanted = Math.min(size.height, MAX_POPUP_HEIGHT_PX)
  const below = wanted <= spaceBelow || spaceBelow >= spaceAbove
  const maxHeight = Math.max(0, Math.min(MAX_POPUP_HEIGHT_PX, below ? spaceBelow : spaceAbove))
  const height = Math.min(wanted, maxHeight)
  const rightmost = viewport.width - size.width - VIEWPORT_MARGIN_PX
  return {
    left: Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, rightmost)),
    top: below ? anchor.bottom : anchor.top - height,
    maxHeight
  }
}
