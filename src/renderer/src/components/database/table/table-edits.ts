import { translate } from '@/i18n/i18n'
import {
  databaseCellText,
  isDatabaseTruncatedCell,
  type DatabaseCell,
  type DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import type {
  TableChange,
  TableChangeSet,
  TableChangeValue
} from '../../../../../shared/database/table-change-sql'
import type { GridRowEditState } from '../grid/grid-editing-types'

type CellEdits = Readonly<Record<number, TableChangeValue>>

export type InsertedRow = { id: string; values: CellEdits }

/** Pending edits to one table tab; rows are loaded-row indexes, which paging never shifts. */
export type TableEdits = {
  updates: Readonly<Record<number, CellEdits>>
  deletes: readonly number[]
  /** Shown after the loaded rows; a column left out takes the table's default. */
  inserts: readonly InsertedRow[]
}

export const NO_TABLE_EDITS: TableEdits = { updates: {}, deletes: [], inserts: [] }

const EMPTY_SET: ReadonlySet<number> = new Set()

function columnsOf(values: CellEdits): number[] {
  return Object.keys(values)
    .map(Number)
    .sort((left, right) => left - right)
}

function withoutKey<T>(record: Readonly<Record<number, T>>, key: number): Record<number, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

export function tableEditCount(edits: TableEdits): number {
  const updatedRows = Object.keys(edits.updates).filter(
    (row) => !edits.deletes.includes(Number(row))
  )
  return edits.deletes.length + updatedRows.length + edits.inserts.length
}

/** Sets one cell of a display row; setting a loaded cell back to its loaded value drops the edit. */
export function setTableCell(
  edits: TableEdits,
  loadedRows: readonly DatabaseCell[][],
  row: number,
  column: number,
  value: TableChangeValue
): TableEdits {
  if (row >= loadedRows.length) {
    const index = row - loadedRows.length
    return {
      ...edits,
      inserts: edits.inserts.map((inserted, position) =>
        position === index
          ? { ...inserted, values: { ...inserted.values, [column]: value } }
          : inserted
      )
    }
  }
  const rowEdits = edits.updates[row] ?? {}
  const loadedValue = databaseCellText(loadedRows[row]?.[column] ?? null)
  const nextRow =
    value === loadedValue ? withoutKey(rowEdits, column) : { ...rowEdits, [column]: value }
  const updates =
    Object.keys(nextRow).length === 0
      ? withoutKey(edits.updates, row)
      : { ...edits.updates, [row]: nextRow }
  return { ...edits, updates }
}

export function addTableRow(edits: TableEdits, id: string): TableEdits {
  return { ...edits, inserts: [...edits.inserts, { id, values: {} }] }
}

/** Marks loaded rows for deletion; new rows are simply dropped. */
export function deleteTableRows(
  edits: TableEdits,
  rows: readonly number[],
  loadedCount: number
): TableEdits {
  const dropped = new Set(rows.filter((row) => row >= loadedCount).map((row) => row - loadedCount))
  const deletes = new Set([...edits.deletes, ...rows.filter((row) => row < loadedCount)])
  return {
    ...edits,
    deletes: [...deletes].sort((left, right) => left - right),
    inserts: edits.inserts.filter((_row, index) => !dropped.has(index))
  }
}

/** Reverts cells (or whole rows with `'all'`): a deleted row comes back, a new row goes away. */
export function revertTableEdits(
  edits: TableEdits,
  rows: readonly number[],
  columns: readonly number[] | 'all',
  loadedCount: number
): TableEdits {
  let updates = edits.updates
  const reverted = new Set(rows)
  for (const row of rows.filter((candidate) => candidate < loadedCount)) {
    const rowEdits = updates[row]
    if (!rowEdits) {
      continue
    }
    const kept = columns === 'all' ? {} : columns.reduce(withoutKey, rowEdits)
    updates =
      Object.keys(kept).length === 0 ? withoutKey(updates, row) : { ...updates, [row]: kept }
  }
  const inserts = edits.inserts.flatMap((inserted, index) => {
    if (!reverted.has(loadedCount + index)) {
      return [inserted]
    }
    return columns === 'all'
      ? []
      : [{ ...inserted, values: columns.reduce(withoutKey, inserted.values) }]
  })
  return { updates, deletes: edits.deletes.filter((row) => !reverted.has(row)), inserts }
}

/** The rows the grid shows (edits applied, new rows last) and each row's edit state. */
export function displayTableRows(
  loadedRows: readonly DatabaseCell[][],
  edits: TableEdits,
  columnCount: number
): { rows: DatabaseCell[][]; rowState: (row: number) => GridRowEditState | null } {
  const rows = loadedRows.map((row, index) => {
    const rowEdits = edits.updates[index]
    return rowEdits
      ? row.map((cell, column) => (column in rowEdits ? rowEdits[column]! : cell))
      : row
  })
  const columnIndexes = Array.from({ length: columnCount }, (_value, column) => column)
  for (const inserted of edits.inserts) {
    rows.push(columnIndexes.map((column) => inserted.values[column] ?? null))
  }
  const deleted = new Set(edits.deletes)
  const rowState = (row: number): GridRowEditState | null => {
    if (row >= loadedRows.length) {
      const values = edits.inserts[row - loadedRows.length]?.values ?? {}
      const set = new Set(columnsOf(values))
      return {
        kind: 'inserted',
        modified: set,
        unset: new Set(columnIndexes.filter((column) => !set.has(column)))
      }
    }
    const rowEdits = edits.updates[row]
    if (!rowEdits && !deleted.has(row)) {
      return null
    }
    return {
      kind: deleted.has(row) ? 'deleted' : 'loaded',
      modified: rowEdits ? new Set(columnsOf(rowEdits)) : EMPTY_SET,
      unset: EMPTY_SET
    }
  }
  return { rows, rowState }
}

type ChangeTarget = {
  loadedRows: readonly DatabaseCell[][]
  columns: readonly DatabaseColumn[]
  keyColumns: readonly string[]
  schema: string
  relation: string
}

export type BuiltTableChanges =
  | { ok: true; changeSet: TableChangeSet; rowForChange: number[] }
  | { ok: false; row: number; message: string }

/** Turns pending edits into the change set main applies: deletes, then updates, then inserts. */
export function buildTableChangeSet(edits: TableEdits, target: ChangeTarget): BuiltTableChanges {
  const keyIndexes = target.keyColumns.map((name) =>
    target.columns.findIndex((column) => column.name === name)
  )
  const assignments = (values: CellEdits) =>
    columnsOf(values).map((column) => ({
      column: target.columns[column]?.name ?? '',
      value: values[column] ?? null
    }))
  const changes: TableChange[] = []
  const rowForChange: number[] = []
  const deleted = new Set(edits.deletes)
  const updatedRows = Object.keys(edits.updates)
    .map(Number)
    .filter((row) => !deleted.has(row))
    .sort((left, right) => left - right)
  for (const [row, kind] of [
    ...edits.deletes.map((row) => [row, 'delete'] as const),
    ...updatedRows.map((row) => [row, 'update'] as const)
  ]) {
    const cells = target.loadedRows[row] ?? []
    const key = keyIndexes.map((index) => {
      const cell = index < 0 ? null : (cells[index] ?? null)
      return isDatabaseTruncatedCell(cell) ? null : databaseCellText(cell)
    })
    if (key.some((value) => value === null)) {
      return {
        ok: false,
        row,
        message: translate(
          'database.edit.keyTruncated',
          'This row’s key was not loaded in full, so it can’t be changed.'
        )
      }
    }
    changes.push(
      kind === 'delete' ? { kind, key } : { kind, key, set: assignments(edits.updates[row] ?? {}) }
    )
    rowForChange.push(row)
  }
  edits.inserts.forEach((inserted, index) => {
    changes.push({ kind: 'insert', values: assignments(inserted.values) })
    rowForChange.push(target.loadedRows.length + index)
  })
  const { schema, relation, keyColumns } = target
  return {
    ok: true,
    changeSet: { schema, relation, keyColumns: [...keyColumns], changes },
    rowForChange
  }
}
