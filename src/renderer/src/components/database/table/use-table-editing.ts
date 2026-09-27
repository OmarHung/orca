import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import type {
  DatabaseCell,
  DatabaseRowsResult
} from '../../../../../shared/database/database-query-types'
import { tableChangePreview } from '../../../../../shared/database/table-change-sql'
import { asDatabaseResult } from '../database-connections-store'
import type { DatabaseTableTab } from '../database-page-store'
import { isNumericColumnType } from '../grid/database-grid-columns'
import type { GridBounds, GridCell } from '../grid/database-grid-selection'
import type { GridEditing } from '../grid/grid-editing-types'
import { getTableEditState, useDatabaseTableEditsStore } from './database-table-edits-store'
import { cellLockReason, tableLockReason, type TableKeyState } from './table-edit-locks'
import {
  addTableRow,
  buildTableChangeSet,
  deleteTableRows,
  displayTableRows,
  revertTableEdits,
  setTableCell,
  tableEditCount,
  type BuiltTableChanges,
  type TableEdits
} from './table-edits'

const NO_ROWS: DatabaseCell[][] = []

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_value, index) => from + index)
}

/** Loads the table's primary key once its data is on screen (the session is connected then). */
function useTableKey(tab: DatabaseTableTab, hasResult: boolean): TableKeyState {
  const [keys, setKeys] = useState<TableKeyState>({ status: 'loading' })
  useEffect(() => {
    if (!hasResult) {
      return
    }
    let current = true
    void window.api.database
      .introspect(tab.connectionId, {
        level: 'columns',
        schema: tab.schema,
        relation: tab.relation
      })
      .then((raw) => {
        const response = asDatabaseResult(raw)
        if (!current) {
          return
        }
        if (!response.ok) {
          setKeys({ status: 'failed', message: response.error.message })
        } else if (response.value.level === 'columns') {
          const keyColumns = response.value.columns.filter((column) => column.isPrimaryKey)
          setKeys({ status: 'ready', keyColumns: keyColumns.map((column) => column.name) })
        }
      })
    return () => {
      current = false
    }
  }, [tab.connectionId, tab.schema, tab.relation, hasResult])
  return keys
}

/** Pending edits for one table tab, wired to the grid and to submit/preview. */
export function useTableEditing({
  tab,
  driver,
  readOnly,
  result,
  onSubmitted
}: {
  tab: DatabaseTableTab
  driver: DatabaseDriver | undefined
  readOnly: boolean
  result: DatabaseRowsResult | null
  onSubmitted: () => void
}) {
  const state = useDatabaseTableEditsStore((store) => getTableEditState(store.tabs, tab.id))
  const keys = useTableKey(tab, result !== null)
  const [editRequest, setEditRequest] = useState<GridEditing['editRequest']>(null)
  const [selected, setSelected] = useState<GridBounds | null>(null)
  const columns = useMemo(() => result?.columns ?? [], [result])
  const loadedRows = result?.rows ?? NO_ROWS
  const display = useMemo(
    () => displayTableRows(loadedRows, state.edits, columns.length),
    [loadedRows, state.edits, columns.length]
  )
  const tableLock = tableLockReason(
    readOnly,
    keys,
    columns.map((column) => column.name)
  )
  const edit = (update: (edits: TableEdits) => TableEdits): void =>
    useDatabaseTableEditsStore.getState().edit(tab.id, update)
  const lockReason = (cell: GridCell): string | null =>
    cellLockReason(
      display.rowState(cell.row),
      columns[cell.column]?.typeName ?? '',
      display.rows[cell.row]?.[cell.column] ?? null
    )
  const build = (): Extract<BuiltTableChanges, { ok: true }> | null => {
    if (keys.status !== 'ready' || !result) {
      return null
    }
    const built = buildTableChangeSet(state.edits, {
      loadedRows,
      columns,
      keyColumns: keys.keyColumns,
      schema: tab.schema,
      relation: tab.relation
    })
    if (!built.ok) {
      useDatabaseTableEditsStore.getState().setFailedRow(tab.id, built.row)
      toast.error(built.message)
      return null
    }
    return built
  }

  const editing: GridEditing | undefined =
    result && !tableLock
      ? {
          rowState: display.rowState,
          failedRow: state.failedRow,
          lockReason,
          commit: (cell, value) =>
            edit((edits) => setTableCell(edits, loadedRows, cell.row, cell.column, value)),
          setNull: (bounds) =>
            edit((edits) =>
              range(bounds.top, bounds.bottom)
                .flatMap((row) =>
                  range(bounds.left, bounds.right).map((column) => ({ row, column }))
                )
                .filter((cell) => lockReason(cell) === null)
                .reduce(
                  (next, cell) => setTableCell(next, loadedRows, cell.row, cell.column, null),
                  edits
                )
            ),
          deleteRows: (bounds) =>
            edit((edits) =>
              deleteTableRows(edits, range(bounds.top, bounds.bottom), loadedRows.length)
            ),
          revert: (bounds) =>
            edit((edits) =>
              revertTableEdits(
                edits,
                range(bounds.top, bounds.bottom),
                bounds.left === 0 && bounds.right === columns.length - 1
                  ? 'all'
                  : range(bounds.left, bounds.right),
                loadedRows.length
              )
            ),
          editRequest,
          onSelectionChange: setSelected
        }
      : undefined

  const submit = async (): Promise<void> => {
    const built = build()
    if (!built || !driver) {
      return
    }
    const store = useDatabaseTableEditsStore.getState()
    store.setSubmitting(tab.id, true)
    const response = asDatabaseResult(
      await window.api.database.applyChanges({
        connectionId: tab.connectionId,
        consoleId: tab.consoleId,
        changeSet: built.changeSet
      })
    )
    store.setSubmitting(tab.id, false)
    if (!response.ok) {
      const index = response.error.changeIndex
      store.setFailedRow(tab.id, index === undefined ? null : (built.rowForChange[index] ?? null))
      toast.error(translate('database.edit.submitFailed', 'Nothing was saved'), {
        description: response.error.message
      })
      return
    }
    store.reset(tab.id)
    toast.success(
      response.value.applied === 1
        ? translate('database.edit.submittedOne', 'Saved 1 change')
        : translate('database.edit.submitted', 'Saved {{value0}} changes', {
            value0: response.value.applied.toLocaleString(getIntlLocale())
          })
    )
    onSubmitted()
  }

  return {
    editing,
    tableLock: result ? tableLock : null,
    rows: display.rows,
    pendingCount: tableEditCount(state.edits),
    submitting: state.submitting,
    hasSelection: selected !== null,
    addRow: () => {
      setEditRequest({
        row: loadedRows.length + state.edits.inserts.length,
        column: 0,
        nonce: Date.now()
      })
      edit((edits) => addTableRow(edits, createBrowserUuid()))
    },
    deleteSelected: () => (selected ? editing?.deleteRows(selected) : undefined),
    revertAll: () => useDatabaseTableEditsStore.getState().reset(tab.id),
    previewSql: (): string | null => {
      const built = build()
      if (!built || !driver) {
        return null
      }
      const numeric = new Set(
        columns
          .filter((column) => isNumericColumnType(column.typeName))
          .map((column) => column.name)
      )
      return tableChangePreview(driver, built.changeSet, numeric)
    },
    submit
  }
}
