import { describe, expect, it } from 'vitest'
import {
  isCellSelected,
  moveSelection,
  selectAll,
  selectCell,
  selectRow,
  selectionBounds
} from './database-grid-selection'

describe('grid selection', () => {
  it('selects a single cell and extends a rectangle from the anchor', () => {
    const start = selectCell(null, { row: 2, column: 1 }, false)
    const extended = selectCell(start, { row: 0, column: 3 }, true)
    expect(selectionBounds(extended)).toEqual({ top: 0, bottom: 2, left: 1, right: 3 })
    expect(isCellSelected(extended, 1, 2)).toBe(true)
    expect(isCellSelected(extended, 3, 2)).toBe(false)
  })

  it('moves the cursor with arrows, or grows the rectangle with Shift, clamped to the grid', () => {
    const cell = selectCell(null, { row: 0, column: 0 }, false)
    expect(moveSelection(cell, 'ArrowUp', false, 5, 3)).toEqual(cell)
    const grown = moveSelection(
      moveSelection(cell, 'ArrowDown', true, 5, 3)!,
      'ArrowRight',
      true,
      5,
      3
    )
    expect(selectionBounds(grown!)).toEqual({ top: 0, bottom: 1, left: 0, right: 1 })
    const moved = moveSelection(grown!, 'ArrowDown', false, 5, 3)
    expect(selectionBounds(moved!)).toEqual({ top: 2, bottom: 2, left: 1, right: 1 })
  })

  it('ignores other keys', () => {
    expect(
      moveSelection(selectCell(null, { row: 0, column: 0 }, false), 'a', false, 5, 3)
    ).toBeNull()
  })

  it('selects whole rows from the row header, extending from the anchor row', () => {
    const first = selectRow(null, 3, false, 4)
    expect(selectionBounds(first)).toEqual({ top: 3, bottom: 3, left: 0, right: 3 })
    expect(selectionBounds(selectRow(first, 1, true, 4))).toEqual({
      top: 1,
      bottom: 3,
      left: 0,
      right: 3
    })
  })

  it('selects everything', () => {
    expect(selectionBounds(selectAll(4, 2))).toEqual({ top: 0, bottom: 3, left: 0, right: 1 })
  })
})
