import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  databaseCellText,
  type DatabaseCell
} from '../../../../../shared/database/database-query-types'
import type { GridCell } from './database-grid-selection'
import type { GridEditing } from './grid-editing-types'

export type ActiveCellEdit = GridCell & { initial: string; wasNull: boolean }

/**
 * The cell being edited in place. Starting explains a locked cell instead; committing an
 * untouched value (or an empty one over NULL) stages nothing.
 */
export function useGridCellEditing(
  editing: GridEditing | undefined,
  rows: readonly DatabaseCell[][],
  onRequestedCell: (cell: GridCell) => void,
  refocusGrid: () => void
): {
  active: ActiveCellEdit | null
  start: (cell: GridCell) => void
  commit: (value: string) => void
  cancel: () => void
} {
  const [active, setActive] = useState<ActiveCellEdit | null>(null)

  const start = (cell: GridCell): void => {
    if (!editing) {
      return
    }
    const reason = editing.lockReason(cell)
    if (reason) {
      toast(reason)
      return
    }
    const text = databaseCellText(rows[cell.row]?.[cell.column] ?? null)
    setActive({ ...cell, initial: text ?? '', wasNull: text === null })
  }

  const request = editing?.editRequest ?? null
  // Why an effect: the owner asks for an edit (e.g. a new row) by publishing a request.
  useEffect(() => {
    if (request) {
      onRequestedCell(request)
      start(request)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once per published request
  }, [request])

  const finish = (): void => {
    setActive(null)
    refocusGrid()
  }
  return {
    active,
    start,
    commit: (value) => {
      if (active && value !== active.initial && !(active.wasNull && value === '')) {
        editing?.commit(active, value)
      }
      finish()
    },
    cancel: finish
  }
}
