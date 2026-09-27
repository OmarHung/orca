import type React from 'react'
import { useEffect, useRef } from 'react'
import {
  isCellSelected,
  selectCell,
  selectRow,
  type GridCell,
  type GridSelection
} from './database-grid-selection'

/** Column index the row-number header carries in `data-grid-column`. */
export const ROW_HEADER_COLUMN = -1

/** The cell (or row-number header) an event happened in. */
function gridCellFromTarget(target: EventTarget | null): GridCell | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-grid-row]') : null
  if (!element) {
    return null
  }
  const row = Number(element.dataset.gridRow)
  const column = Number(element.dataset.gridColumn)
  return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null
}

function pick(
  current: GridSelection | null,
  cell: GridCell,
  extend: boolean,
  columnCount: number
): GridSelection {
  return cell.column === ROW_HEADER_COLUMN
    ? selectRow(current, cell.row, extend, columnCount)
    : selectCell(current, cell, extend)
}

/**
 * Mouse selection delegated from the grid container: press starts a cell or row
 * selection (Shift extends it), dragging grows it, right-click keeps a selection
 * the pointer is inside so the context menu acts on it.
 */
export function useGridPointerSelection(
  columnCount: number,
  setSelection: React.Dispatch<React.SetStateAction<GridSelection | null>>
): {
  onMouseDown: (event: React.MouseEvent) => void
  onMouseOver: (event: React.MouseEvent) => void
} {
  const dragRef = useRef<{ rows: boolean } | null>(null)

  useEffect(() => {
    const endDrag = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [])

  return {
    onMouseDown: (event) => {
      const cell = gridCellFromTarget(event.target)
      if (!cell) {
        return
      }
      if (event.button === 2) {
        setSelection((current) =>
          isCellSelected(current, cell.row, Math.max(0, cell.column))
            ? current
            : pick(current, cell, false, columnCount)
        )
        return
      }
      if (event.button === 0) {
        dragRef.current = { rows: cell.column === ROW_HEADER_COLUMN }
        setSelection((current) => pick(current, cell, event.shiftKey, columnCount))
      }
    },
    onMouseOver: (event) => {
      const drag = dragRef.current
      const cell = drag ? gridCellFromTarget(event.target) : null
      if (!drag || !cell) {
        return
      }
      // Why clamp: a cell drag that crosses the row numbers stays a cell selection.
      const focus = {
        row: cell.row,
        column: drag.rows ? ROW_HEADER_COLUMN : Math.max(0, cell.column)
      }
      setSelection((current) => pick(current, focus, true, columnCount))
    }
  }
}
