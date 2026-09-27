export type GridCell = { row: number; column: number }

/** A rectangle from `anchor` (where selection started) to `focus` (the moving corner). */
export type GridSelection = { anchor: GridCell; focus: GridCell }

export type GridBounds = { top: number; bottom: number; left: number; right: number }

export function selectCell(
  current: GridSelection | null,
  cell: GridCell,
  extend: boolean
): GridSelection {
  return extend && current ? { anchor: current.anchor, focus: cell } : { anchor: cell, focus: cell }
}

/** Row-header click: the whole row, or every row from the anchor's with Shift. */
export function selectRow(
  current: GridSelection | null,
  row: number,
  extend: boolean,
  columnCount: number
): GridSelection {
  const anchorRow = extend && current ? current.anchor.row : row
  return {
    anchor: { row: anchorRow, column: 0 },
    focus: { row, column: Math.max(0, columnCount - 1) }
  }
}

export function selectAll(rowCount: number, columnCount: number): GridSelection {
  return {
    anchor: { row: 0, column: 0 },
    focus: { row: Math.max(0, rowCount - 1), column: Math.max(0, columnCount - 1) }
  }
}

export function selectionBounds(selection: GridSelection): GridBounds {
  const { anchor, focus } = selection
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column)
  }
}

export function isCellSelected(
  selection: GridSelection | null,
  row: number,
  column: number
): boolean {
  if (!selection) {
    return false
  }
  const bounds = selectionBounds(selection)
  return (
    row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right
  )
}

const ARROW_DELTAS: Record<string, GridCell> = {
  ArrowUp: { row: -1, column: 0 },
  ArrowDown: { row: 1, column: 0 },
  ArrowLeft: { row: 0, column: -1 },
  ArrowRight: { row: 0, column: 1 }
}

/** Arrow keys move the cursor; with Shift they move the focus corner and keep the anchor. */
export function moveSelection(
  selection: GridSelection,
  key: string,
  extend: boolean,
  rowCount: number,
  columnCount: number
): GridSelection | null {
  const delta = ARROW_DELTAS[key]
  if (!delta) {
    return null
  }
  const focus = {
    row: Math.max(0, Math.min(rowCount - 1, selection.focus.row + delta.row)),
    column: Math.max(0, Math.min(columnCount - 1, selection.focus.column + delta.column))
  }
  return extend ? { anchor: selection.anchor, focus } : { anchor: focus, focus }
}
