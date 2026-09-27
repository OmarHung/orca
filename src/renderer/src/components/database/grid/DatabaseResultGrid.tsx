import React, { useEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import type {
  DatabaseCell,
  DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import type { DatabaseExportFormat } from '../../../../../shared/database/database-export-types'
import { useDatabasePageStore } from '../database-page-store'
import { DatabaseGridCellEditor } from './DatabaseGridCellEditor'
import { DatabaseGridContextMenu } from './DatabaseGridContextMenu'
import { DatabaseGridHeader, type GridColumn } from './DatabaseGridHeader'
import { DatabaseGridRow, GRID_ROW_HEIGHT } from './DatabaseGridRow'
import { DatabaseValueViewer } from './DatabaseValueViewer'
import {
  GRID_ROW_NUMBER_PX,
  isNumericColumnType,
  scrollLeftToReveal
} from './database-grid-columns'
import { gridExportSlice } from './database-grid-export'
import {
  moveSelection,
  selectAll,
  selectionBounds,
  type GridCell,
  type GridSelection
} from './database-grid-selection'
import { nextGridSort, sortedRowOrder, type GridSort } from './database-grid-sort'
import {
  copyGridText,
  saveGridExport,
  type GridCopyFormat,
  type GridExportTarget
} from './database-grid-transfer'
import type { GridEditing } from './grid-editing-types'
import { useGridCellEditing } from './use-grid-cell-editing'
import { useGridColumnWidths } from './use-grid-column-widths'
import { gridCellFromTarget, useGridPointerSelection } from './use-grid-pointer-selection'

const HEADER_HEIGHT = 40
const OVERSCAN = 16
// Start loading the next page this many rows before the end.
const PREFETCH_ROWS = 60

type DatabaseResultGridProps = {
  columns: DatabaseColumn[]
  rows: DatabaseCell[][]
  canLoadMore: boolean
  onLoadMore: () => void
  /** Table data sorts on the server; query results sort the rows already loaded. */
  serverSort?: { sort: GridSort; onChange: (sort: GridSort) => void }
  exportTarget: GridExportTarget
  /** Editable table data; rows are then shown in the given order. */
  editing?: GridEditing
}

function isModShortcut(event: React.KeyboardEvent, key: string): boolean {
  const isMac = navigator.userAgent.includes('Mac')
  return (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === key
}

/** Result grid: CSS-grid rows (not <table>) so virtualized rows keep column widths. */
export function DatabaseResultGrid({
  columns,
  rows,
  canLoadMore,
  onLoadMore,
  serverSort,
  exportTarget,
  editing
}: DatabaseResultGridProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { widths, setWidth, autoFit } = useGridColumnWidths(columns, rows)
  const [selection, setSelection] = useState<GridSelection | null>(null)
  const [localSort, setLocalSort] = useState<GridSort>(null)
  // Why reset on identity: every new result gets a fresh column array; appended pages keep it.
  const [resultColumns, setResultColumns] = useState(columns)
  if (resultColumns !== columns) {
    setResultColumns(columns)
    setSelection(null)
    setLocalSort(null)
  }
  const viewerOpen = useDatabasePageStore((state) => state.valueViewerOpen)
  const toggleViewer = useDatabasePageStore((state) => state.toggleValueViewer)
  const pointer = useGridPointerSelection(columns.length, setSelection)

  // Why positional ids: result columns can share a name (`select 1, 1`) but never reorder.
  const gridColumns = useMemo<GridColumn[]>(
    () =>
      columns.map((column, position) => ({
        id: `${position}:${column.name}`,
        position,
        column,
        numeric: isNumericColumnType(column.typeName)
      })),
    [columns]
  )
  const isServerSorted = serverSort !== undefined
  const displayOrder = useMemo(
    () =>
      sortedRowOrder(
        rows,
        isServerSorted ? null : localSort,
        gridColumns.map((gridColumn) => gridColumn.numeric)
      ),
    [rows, isServerSorted, localSort, gridColumns]
  )
  const sort = serverSort ? serverSort.sort : localSort
  const gridTemplate = `${GRID_ROW_NUMBER_PX}px ${widths.map((width) => `${width}px`).join(' ')}`

  const editingRowRef = useRef<number | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    // Why: an editor scrolled out of the rendered range would unmount and lose its edit.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const editingRow = editingRowRef.current
      return editingRow === null || indexes.includes(editingRow)
        ? indexes
        : [...indexes, editingRow].sort((left, right) => left - right)
    },
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_HEIGHT,
    overscan: OVERSCAN,
    paddingStart: HEADER_HEIGHT,
    // Why: the sticky header covers the top of the viewport when revealing a row.
    scrollPaddingStart: HEADER_HEIGHT
  })
  const virtualRows = virtualizer.getVirtualItems()
  const lastVisibleIndex = virtualRows.at(-1)?.index ?? 0

  useEffect(() => {
    if (canLoadMore && lastVisibleIndex >= rows.length - PREFETCH_ROWS) {
      onLoadMore()
    }
  }, [canLoadMore, lastVisibleIndex, rows.length, onLoadMore])

  const bounds = selection ? selectionBounds(selection) : null
  const onSelectionChange = editing?.onSelectionChange
  useEffect(() => {
    onSelectionChange?.(selection ? selectionBounds(selection) : null)
  }, [selection, onSelectionChange])
  const copySelection = (format: GridCopyFormat): void => {
    if (bounds) {
      copyGridText(gridExportSlice(columns, rows, displayOrder, bounds), format, exportTarget)
    }
  }
  const exportLoaded = (format: DatabaseExportFormat): void =>
    void saveGridExport(gridExportSlice(columns, rows, displayOrder, null), format, exportTarget)
  const changeSort = (position: number): void => {
    const next = nextGridSort(sort, position)
    setSelection(null)
    if (serverSort) {
      serverSort.onChange(next)
    } else {
      setLocalSort(next)
    }
  }
  const reveal = (cell: GridCell): void => {
    virtualizer.scrollToIndex(cell.row)
    const element = scrollRef.current
    if (element) {
      element.scrollLeft = scrollLeftToReveal(
        widths,
        cell.column,
        element.scrollLeft,
        element.clientWidth
      )
    }
  }

  const cellEditing = useGridCellEditing(
    editing,
    rows,
    (cell) => {
      setSelection({ anchor: cell, focus: cell })
      reveal(cell)
    },
    () => scrollRef.current?.focus()
  )
  editingRowRef.current = cellEditing.active?.row ?? null

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Why: arrows on a focused column edge or header button belong to that control.
    if (event.target !== event.currentTarget) {
      return
    }
    if (isModShortcut(event, 'a') && rows.length > 0) {
      event.preventDefault()
      setSelection(selectAll(rows.length, columns.length))
      return
    }
    if (!selection) {
      return
    }
    if (isModShortcut(event, 'c')) {
      event.preventDefault()
      copySelection('tsv')
      return
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      toggleViewer()
      return
    }
    if (editing && bounds && (event.key === 'Enter' || event.key === 'F2')) {
      event.preventDefault()
      cellEditing.start(selection.focus)
      return
    }
    if (editing && bounds && isModShortcut(event, 'backspace')) {
      event.preventDefault()
      editing.deleteRows(bounds)
      return
    }
    const next = moveSelection(selection, event.key, event.shiftKey, rows.length, columns.length)
    if (next) {
      event.preventDefault()
      setSelection(next)
      reveal(next.focus)
    }
  }

  const focus = selection?.focus ?? null
  const focusCell = focus ? (rows[displayOrder[focus.row] ?? -1]?.[focus.column] ?? null) : null
  return (
    <div className="flex h-full min-h-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            tabIndex={0}
            role="grid"
            aria-multiselectable
            aria-rowcount={rows.length + 1}
            aria-colcount={columns.length + 1}
            onKeyDown={handleKeyDown}
            onMouseDown={pointer.onMouseDown}
            onMouseOver={pointer.onMouseOver}
            onDoubleClick={(event) => {
              const cell = gridCellFromTarget(event.target)
              if (cell && cell.column >= 0) {
                cellEditing.start(cell)
              }
            }}
            className="relative h-full min-h-0 min-w-0 flex-1 select-none overflow-auto scrollbar-editor font-mono text-xs outline-none"
          >
            <div
              style={{ width: 'max-content', minWidth: '100%', height: virtualizer.getTotalSize() }}
            >
              <DatabaseGridHeader
                gridColumns={gridColumns}
                widths={widths}
                gridTemplate={gridTemplate}
                height={HEADER_HEIGHT}
                sort={sort}
                onSort={changeSort}
                onResize={setWidth}
                onAutoFit={autoFit}
                onSelectAll={() => setSelection(selectAll(rows.length, columns.length))}
              />
              {virtualRows.map((virtualRow) => {
                const inSelection =
                  bounds !== null &&
                  virtualRow.index >= bounds.top &&
                  virtualRow.index <= bounds.bottom
                return (
                  <DatabaseGridRow
                    key={virtualRow.key}
                    displayIndex={virtualRow.index}
                    row={rows[displayOrder[virtualRow.index] ?? virtualRow.index] ?? []}
                    gridColumns={gridColumns}
                    gridTemplate={gridTemplate}
                    start={virtualRow.start}
                    selectedSpan={inSelection ? bounds : null}
                    focusColumn={focus?.row === virtualRow.index ? focus.column : null}
                    editState={editing?.rowState(virtualRow.index) ?? null}
                    failed={editing?.failedRow === virtualRow.index}
                    editor={
                      cellEditing.active?.row === virtualRow.index
                        ? {
                            column: cellEditing.active.column,
                            node: (
                              <DatabaseGridCellEditor
                                column={columns[cellEditing.active.column]?.name ?? ''}
                                initial={cellEditing.active.initial}
                                onCommit={cellEditing.commit}
                                onCancel={cellEditing.cancel}
                              />
                            )
                          }
                        : null
                    }
                  />
                )
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <DatabaseGridContextMenu
          editActions={
            editing && bounds && selection
              ? {
                  edit: () => cellEditing.start(selection.focus),
                  setNull: () => editing.setNull(bounds),
                  deleteRows: () => editing.deleteRows(bounds),
                  revert: () => editing.revert(bounds)
                }
              : undefined
          }
          onCopy={copySelection}
          onExport={exportLoaded}
          onShowValue={() => {
            if (!viewerOpen) {
              toggleViewer()
            }
          }}
        />
      </ContextMenu>
      {viewerOpen ? (
        <DatabaseValueViewer
          column={focus ? (columns[focus.column] ?? null) : null}
          cell={focusCell}
        />
      ) : null}
    </div>
  )
}
