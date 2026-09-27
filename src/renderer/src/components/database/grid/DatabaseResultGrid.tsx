import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  databaseCellText,
  isDatabaseTruncatedCell,
  type DatabaseCell,
  type DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import {
  GRID_ROW_NUMBER_PX,
  gridCellDisplayText,
  isNumericColumnType,
  measureGridColumns
} from './database-grid-columns'

const ROW_HEIGHT = 26
const HEADER_HEIGHT = 40
const OVERSCAN = 16
// Start loading the next page this many rows before the end.
const PREFETCH_ROWS = 60

type CellPosition = { row: number; column: number }

type DatabaseResultGridProps = {
  columns: DatabaseColumn[]
  rows: DatabaseCell[][]
  canLoadMore: boolean
  onLoadMore: () => void
}

function isCopyShortcut(event: React.KeyboardEvent): boolean {
  const isMac = navigator.userAgent.includes('Mac')
  return (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'c'
}

function moveSelection(
  position: CellPosition,
  key: string,
  rowCount: number,
  columnCount: number
): CellPosition | null {
  const clampRow = (row: number): number => Math.max(0, Math.min(rowCount - 1, row))
  const clampColumn = (column: number): number => Math.max(0, Math.min(columnCount - 1, column))
  switch (key) {
    case 'ArrowUp':
      return { ...position, row: clampRow(position.row - 1) }
    case 'ArrowDown':
      return { ...position, row: clampRow(position.row + 1) }
    case 'ArrowLeft':
      return { ...position, column: clampColumn(position.column - 1) }
    case 'ArrowRight':
      return { ...position, column: clampColumn(position.column + 1) }
    default:
      return null
  }
}

/** Read-only result grid: CSS-grid rows (not <table>) so virtualized rows keep column widths. */
export function DatabaseResultGrid({
  columns,
  rows,
  canLoadMore,
  onLoadMore
}: DatabaseResultGridProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<CellPosition | null>(null)
  // Why measured once per result: re-measuring as pages append would make columns jump.
  const [measured, setMeasured] = useState(() => ({
    columns,
    widths: measureGridColumns(columns, rows)
  }))
  if (measured.columns !== columns) {
    setMeasured({ columns, widths: measureGridColumns(columns, rows) })
    setSelected(null)
  }
  const widths = measured.widths
  const gridTemplate = `${GRID_ROW_NUMBER_PX}px ${widths.map((width) => `${width}px`).join(' ')}`
  // Why positional ids: result columns can share a name (`select 1, 1`) but never reorder.
  const gridColumns = useMemo(
    () =>
      columns.map((column, position) => ({
        id: `${position}:${column.name}`,
        position,
        column,
        numeric: isNumericColumnType(column.typeName)
      })),
    [columns]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    paddingStart: HEADER_HEIGHT
  })
  const virtualRows = virtualizer.getVirtualItems()
  const lastVisibleIndex = virtualRows.at(-1)?.index ?? 0

  useEffect(() => {
    if (canLoadMore && lastVisibleIndex >= rows.length - PREFETCH_ROWS) {
      onLoadMore()
    }
  }, [canLoadMore, lastVisibleIndex, rows.length, onLoadMore])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!selected) {
      return
    }
    if (isCopyShortcut(event)) {
      event.preventDefault()
      const text = databaseCellText(rows[selected.row]?.[selected.column] ?? null)
      void window.api.ui.writeClipboardText(text ?? '')
      return
    }
    const next = moveSelection(selected, event.key, rows.length, columns.length)
    if (next) {
      event.preventDefault()
      setSelected(next)
      virtualizer.scrollToIndex(next.row)
    }
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + 1}
      onKeyDown={handleKeyDown}
      className="relative h-full min-h-0 overflow-auto scrollbar-editor font-mono text-xs outline-none"
    >
      <div style={{ width: 'max-content', minWidth: '100%', height: virtualizer.getTotalSize() }}>
        <div
          role="row"
          className="sticky top-0 z-10 grid border-b border-border bg-muted"
          style={{ gridTemplateColumns: gridTemplate, height: HEADER_HEIGHT }}
        >
          <div className="sticky left-0 z-20 border-r border-border bg-muted" />
          {gridColumns.map(({ id, column, numeric }) => (
            <div
              role="columnheader"
              key={id}
              className={cn(
                'flex min-w-0 flex-col justify-center border-r border-border px-2',
                numeric && 'items-end text-right'
              )}
            >
              <span className="w-full truncate font-medium text-foreground" title={column.name}>
                {column.name}
              </span>
              <span className="w-full truncate text-[10px] text-muted-foreground">
                {column.typeName}
              </span>
            </div>
          ))}
        </div>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index] ?? []
          return (
            <div
              role="row"
              key={virtualRow.key}
              className="absolute left-0 grid hover:bg-accent/40"
              style={{
                gridTemplateColumns: gridTemplate,
                top: 0,
                height: ROW_HEIGHT,
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <div className="sticky left-0 z-[5] flex items-center justify-end border-b border-r border-border/60 bg-background px-2 text-[10px] text-muted-foreground">
                {virtualRow.index + 1}
              </div>
              {gridColumns.map(({ id, position, numeric }) => {
                const cell = row[position] ?? null
                const text = gridCellDisplayText(cell)
                const isSelected =
                  selected?.row === virtualRow.index && selected.column === position
                return (
                  <div
                    role="gridcell"
                    key={id}
                    aria-selected={isSelected}
                    onMouseDown={() => setSelected({ row: virtualRow.index, column: position })}
                    title={
                      isDatabaseTruncatedCell(cell)
                        ? translate(
                            'database.grid.truncated',
                            'Showing the first {{value0}} of {{value1}} characters',
                            {
                              value0: cell.preview.length.toLocaleString(),
                              value1: cell.length.toLocaleString()
                            }
                          )
                        : undefined
                    }
                    className={cn(
                      'flex min-w-0 items-center border-b border-r border-border/60 px-2',
                      numeric && 'justify-end',
                      isSelected && 'bg-accent ring-1 ring-inset ring-ring'
                    )}
                  >
                    {text === null ? (
                      <span className="italic text-muted-foreground">
                        {translate('database.grid.null', 'NULL')}
                      </span>
                    ) : (
                      <span className="truncate text-foreground">
                        {text}
                        {isDatabaseTruncatedCell(cell) ? '…' : null}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
