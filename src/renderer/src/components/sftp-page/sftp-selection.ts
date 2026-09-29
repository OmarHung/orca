export type PaneSelection = { selected: ReadonlySet<string>; anchor: string | null }

export type SelectionModifiers = { toggle: boolean; range: boolean }

export const EMPTY_SELECTION: PaneSelection = { selected: new Set(), anchor: null }

/** Cmd on macOS and Ctrl elsewhere adds to the selection; Shift extends it from the anchor. */
export function selectionModifiersFromEvent(
  event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  isMac: boolean
): SelectionModifiers {
  return { toggle: isMac ? event.metaKey : event.ctrlKey, range: event.shiftKey }
}

export function applySelectionClick(
  selection: PaneSelection,
  orderedPaths: readonly string[],
  clicked: string,
  modifiers: SelectionModifiers
): PaneSelection {
  const anchorIndex = selection.anchor ? orderedPaths.indexOf(selection.anchor) : -1
  if (modifiers.range && anchorIndex !== -1) {
    const clickedIndex = orderedPaths.indexOf(clicked)
    const from = Math.min(anchorIndex, clickedIndex)
    const to = Math.max(anchorIndex, clickedIndex)
    return { selected: new Set(orderedPaths.slice(from, to + 1)), anchor: selection.anchor }
  }
  if (modifiers.toggle) {
    const selected = new Set(selection.selected)
    if (selected.has(clicked)) {
      selected.delete(clicked)
    } else {
      selected.add(clicked)
    }
    return { selected, anchor: clicked }
  }
  return { selected: new Set([clicked]), anchor: clicked }
}

/** Drops entries that disappeared after a refresh. */
export function pruneSelection(
  selection: PaneSelection,
  orderedPaths: readonly string[]
): PaneSelection {
  const present = new Set(orderedPaths)
  const selected = new Set([...selection.selected].filter((entry) => present.has(entry)))
  const anchor = selection.anchor && present.has(selection.anchor) ? selection.anchor : null
  return { selected, anchor }
}
