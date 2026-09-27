import {
  databaseCellText,
  type DatabaseCell
} from '../../../../../shared/database/database-query-types'

export type GridSort = { column: number; direction: 'asc' | 'desc' } | null

/** Header clicks cycle a column through ascending → descending → unsorted. */
export function nextGridSort(current: GridSort, column: number): GridSort {
  if (!current || current.column !== column) {
    return { column, direction: 'asc' }
  }
  return current.direction === 'asc' ? { column, direction: 'desc' } : null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareValues(left: string, right: string, numeric: boolean): number {
  if (numeric) {
    const difference = Number(left) - Number(right)
    if (!Number.isNaN(difference)) {
      return difference
    }
  }
  return collator.compare(left, right)
}

/**
 * Display order of the loaded rows as source indices, so selection and copy can map
 * back to the original rows. NULLs sort last ascending and first descending, like PostgreSQL.
 */
export function sortedRowOrder(
  rows: readonly DatabaseCell[][],
  sort: GridSort,
  numericColumns: readonly boolean[]
): number[] {
  const order = rows.map((_row, index) => index)
  if (!sort) {
    return order
  }
  const numeric = numericColumns[sort.column] ?? false
  const sign = sort.direction === 'asc' ? 1 : -1
  return order.sort((leftIndex, rightIndex) => {
    const left = databaseCellText(rows[leftIndex]?.[sort.column] ?? null)
    const right = databaseCellText(rows[rightIndex]?.[sort.column] ?? null)
    if (left === null || right === null) {
      const nullOrder = left === right ? 0 : left === null ? 1 : -1
      return nullOrder * sign || leftIndex - rightIndex
    }
    return sign * compareValues(left, right, numeric) || leftIndex - rightIndex
  })
}
