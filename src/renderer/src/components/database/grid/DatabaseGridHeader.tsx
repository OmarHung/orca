import React from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DatabaseColumn } from '../../../../../shared/database/database-query-types'
import { ResizeHandle } from '../../bottom-panel/ResizeHandle'
import { useDragResize } from '../../bottom-panel/use-drag-resize'
import {
  GRID_FIT_MAX_COLUMN_PX,
  GRID_MIN_COLUMN_PX,
  gridHeaderTitle
} from './database-grid-columns'
import type { GridSort } from './database-grid-sort'

export type GridColumn = { id: string; position: number; column: DatabaseColumn; numeric: boolean }

function HeaderCell({
  gridColumn,
  comment,
  width,
  sort,
  onSort,
  onResize,
  onAutoFit
}: {
  gridColumn: GridColumn
  comment: string | undefined
  width: number
  sort: GridSort
  onSort: () => void
  onResize: (width: number) => void
  onAutoFit: () => void
}): React.JSX.Element {
  const { column, numeric, position } = gridColumn
  const { handleProps } = useDragResize({
    axis: 'x',
    size: width,
    setSize: onResize,
    onPreview: onResize,
    min: GRID_MIN_COLUMN_PX,
    // Why no container bound: like a spreadsheet, a wider grid scrolls horizontally instead.
    getMax: () => GRID_FIT_MAX_COLUMN_PX * 2,
    direction: 1
  })
  const direction = sort?.column === position ? sort.direction : null
  return (
    <div
      role="columnheader"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className="relative flex min-w-0 border-r border-border"
    >
      <button
        type="button"
        onClick={onSort}
        title={gridHeaderTitle(column.name, comment)}
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center px-2 text-left hover:bg-accent/60',
          numeric && 'items-end text-right'
        )}
      >
        <span
          className={cn(
            'flex w-full min-w-0 items-center gap-1 font-medium text-foreground',
            numeric && 'justify-end'
          )}
        >
          <span className="truncate">{column.name}</span>
          {direction === 'asc' ? <ArrowUp className="size-3 shrink-0" /> : null}
          {direction === 'desc' ? <ArrowDown className="size-3 shrink-0" /> : null}
        </span>
        <span className="w-full truncate text-[10px] text-muted-foreground">{column.typeName}</span>
      </button>
      <ResizeHandle
        edge="right"
        label={translate('database.grid.resizeColumn', 'Resize column {{value0}}', {
          value0: column.name
        })}
        handleProps={handleProps}
        onDoubleClick={onAutoFit}
      />
    </div>
  )
}

export function DatabaseGridHeader({
  gridColumns,
  columnComments,
  widths,
  gridTemplate,
  height,
  sort,
  onSort,
  onResize,
  onAutoFit,
  onSelectAll
}: {
  gridColumns: GridColumn[]
  /** Comments by column name, shown in the header's tooltip (table data only). */
  columnComments: ReadonlyMap<string, string> | undefined
  widths: number[]
  gridTemplate: string
  height: number
  sort: GridSort
  onSort: (position: number) => void
  onResize: (position: number, width: number) => void
  onAutoFit: (position: number) => void
  onSelectAll: () => void
}): React.JSX.Element {
  return (
    <div
      role="row"
      className="sticky top-0 z-10 grid border-b border-border bg-muted"
      style={{ gridTemplateColumns: gridTemplate, height }}
    >
      <button
        type="button"
        aria-label={translate('database.grid.selectAll', 'Select all')}
        onClick={onSelectAll}
        className="sticky left-0 z-20 border-r border-border bg-muted hover:bg-accent"
      />
      {gridColumns.map((gridColumn) => (
        <HeaderCell
          key={gridColumn.id}
          gridColumn={gridColumn}
          comment={columnComments?.get(gridColumn.column.name)}
          width={widths[gridColumn.position] ?? GRID_MIN_COLUMN_PX}
          sort={sort}
          onSort={() => onSort(gridColumn.position)}
          onResize={(width) => onResize(gridColumn.position, width)}
          onAutoFit={() => onAutoFit(gridColumn.position)}
        />
      ))}
    </div>
  )
}
