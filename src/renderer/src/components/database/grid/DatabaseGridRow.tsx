import React from 'react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  isDatabaseTruncatedCell,
  type DatabaseCell
} from '../../../../../shared/database/database-query-types'
import { gridCellDisplayText } from './database-grid-columns'
import type { GridColumn } from './DatabaseGridHeader'
import { ROW_HEADER_COLUMN } from './use-grid-pointer-selection'

export const GRID_ROW_HEIGHT = 26

function truncatedTitle(cell: DatabaseCell): string | undefined {
  return isDatabaseTruncatedCell(cell)
    ? translate(
        'database.grid.truncated',
        'Showing the first {{value0}} of {{value1}} characters',
        {
          value0: cell.preview.length.toLocaleString(getIntlLocale()),
          value1: cell.length.toLocaleString(getIntlLocale())
        }
      )
    : undefined
}

function CellContent({ cell }: { cell: DatabaseCell }): React.JSX.Element {
  const text = gridCellDisplayText(cell)
  if (text === null) {
    return (
      <span className="italic text-muted-foreground">
        {translate('database.grid.null', 'NULL')}
      </span>
    )
  }
  return (
    <span className="truncate text-foreground">
      {text}
      {isDatabaseTruncatedCell(cell) ? '…' : null}
    </span>
  )
}

/**
 * One virtualized row. Cells carry their display coordinates in data attributes so the
 * grid can resolve pointer events once instead of binding handlers per cell.
 */
export function DatabaseGridRow({
  displayIndex,
  row,
  gridColumns,
  gridTemplate,
  start,
  selectedSpan,
  focusColumn
}: {
  displayIndex: number
  row: readonly DatabaseCell[]
  gridColumns: readonly GridColumn[]
  gridTemplate: string
  start: number
  /** Selected columns in this row, inclusive. */
  selectedSpan: { left: number; right: number } | null
  /** Column of the selection's moving corner when it is in this row. */
  focusColumn: number | null
}): React.JSX.Element {
  return (
    <div
      role="row"
      aria-rowindex={displayIndex + 2}
      className="absolute left-0 grid hover:bg-accent/40"
      style={{
        gridTemplateColumns: gridTemplate,
        top: 0,
        height: GRID_ROW_HEIGHT,
        transform: `translateY(${start}px)`
      }}
    >
      <div
        role="rowheader"
        data-grid-row={displayIndex}
        data-grid-column={ROW_HEADER_COLUMN}
        className={cn(
          'sticky left-0 z-[5] flex items-center justify-end border-b border-r border-border/60 bg-background px-2 text-[10px] text-muted-foreground',
          selectedSpan && 'bg-muted text-foreground'
        )}
      >
        {displayIndex + 1}
      </div>
      {gridColumns.map(({ id, position, numeric }) => {
        const cell = row[position] ?? null
        const selected =
          selectedSpan !== null && position >= selectedSpan.left && position <= selectedSpan.right
        return (
          <div
            role="gridcell"
            key={id}
            aria-selected={selected}
            data-grid-row={displayIndex}
            data-grid-column={position}
            title={truncatedTitle(cell)}
            className={cn(
              'flex min-w-0 items-center border-b border-r border-border/60 px-2',
              numeric && 'justify-end',
              selected && 'bg-foreground/10',
              position === focusColumn && 'ring-1 ring-inset ring-ring'
            )}
          >
            <CellContent cell={cell} />
          </div>
        )
      })}
    </div>
  )
}
