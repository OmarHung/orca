import { useState } from 'react'
import type {
  DatabaseCell,
  DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import { fitGridColumn, measureGridColumns } from './database-grid-columns'
import { gridTextWidth } from './grid-text-width'

type Measured = { key: string; widths: number[] }

function columnsKey(columns: readonly DatabaseColumn[]): string {
  return columns.map((column) => `${column.name}\u0000${column.typeName}`).join('\u0001')
}

/**
 * Column widths for one result shape: measured once from its first page (re-measuring as
 * pages append would make columns jump), then owned by the user's drags and double-click
 * fits. Keyed by the column list so re-running a sorted or filtered table keeps them.
 */
export function useGridColumnWidths(
  columns: readonly DatabaseColumn[],
  rows: readonly DatabaseCell[][]
): {
  widths: number[]
  setWidth: (index: number, width: number) => void
  autoFit: (index: number) => void
} {
  const key = columnsKey(columns)
  const [measured, setMeasured] = useState<Measured>(() => ({
    key,
    widths: measureGridColumns(columns, rows, gridTextWidth)
  }))
  let current = measured
  if (measured.key !== key) {
    current = { key, widths: measureGridColumns(columns, rows, gridTextWidth) }
    setMeasured(current)
  }
  const setWidth = (index: number, width: number): void =>
    setMeasured((state) => ({
      ...state,
      widths: state.widths.map((value, position) => (position === index ? width : value))
    }))
  return {
    widths: current.widths,
    setWidth,
    autoFit: (index) => {
      const column = columns[index]
      if (column) {
        setWidth(index, fitGridColumn(column, rows, index, gridTextWidth))
      }
    }
  }
}
