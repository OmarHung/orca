import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { openDatabaseTable } from '../database-page-actions'
import { useDatabasePageStore } from '../database-page-store'
import { DatabaseExplorerRow, EXPLORER_ROW_HEIGHT } from './DatabaseExplorerRow'
import { useDatabaseExplorerStore } from './database-explorer-store'
import {
  databaseExplorerRoots,
  flattenDatabaseExplorer,
  type DatabaseExplorerRow as ExplorerRow
} from './database-explorer-rows'
import { isExpandableNode, type DatabaseExplorerNode } from './database-explorer-tree'
import { TOP_LEVEL_DROP, useConnectionGroupDrop } from './use-connection-group-drop'

type ItemRow = Extract<ExplorerRow, { type: 'node' | 'group' }>

function isItemRow(row: ExplorerRow | undefined): row is ItemRow {
  return row?.type === 'node' || row?.type === 'group'
}

function canExpand(row: ItemRow): boolean {
  return row.type === 'group' || isExpandableNode(row.node)
}

/**
 * The widest row's full width, so the tree scrolls sideways instead of cutting names short. Each
 * row reports its width as it renders; widths stay remembered by key, so scrolling keeps the width.
 */
function useWidestRow(rows: readonly ExplorerRow[]): {
  widest: number
  onMeasure: (key: string, width: number) => void
} {
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(() => new Map())
  const onMeasure = useCallback((key: string, width: number) => {
    setWidths((current) =>
      current.get(key) === width ? current : new Map(current).set(key, width)
    )
  }, [])
  const widest = useMemo(
    () => rows.reduce((max, row) => Math.max(max, widths.get(row.key) ?? 0), 0),
    [rows, widths]
  )
  return { widest, onMeasure }
}

export function DatabaseExplorer(): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const connections = useDatabaseConnectionsStore((state) => state.connections)
  const expanded = useDatabaseExplorerStore((state) => state.expanded)
  const children = useDatabaseExplorerStore((state) => state.children)
  const selectedKey = useDatabaseExplorerStore((state) => state.selectedKey)
  const select = useDatabaseExplorerStore((state) => state.select)
  const toggle = useDatabaseExplorerStore((state) => state.toggle)
  const collapsedGroups = useDatabasePageStore((state) => state.collapsedConnectionGroups)
  const setGroupCollapsed = useDatabasePageStore((state) => state.setConnectionGroupCollapsed)

  const rows = useMemo(
    () =>
      flattenDatabaseExplorer(
        databaseExplorerRoots(connections),
        expanded,
        children,
        new Set(collapsedGroups)
      ),
    [connections, expanded, children, collapsedGroups]
  )
  const { dropTarget, handlers: dropHandlers } = useConnectionGroupDrop(rows, scrollRef)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => EXPLORER_ROW_HEIGHT,
    overscan: 12
  })
  const { widest, onMeasure } = useWidestRow(rows)

  const activate = (node: DatabaseExplorerNode): void => {
    if (node.kind === 'relation') {
      openDatabaseTable(node.connectionId, node.schema, node.relation.name, node.database)
    } else {
      void toggle(node)
    }
  }
  const toggleGroup = (group: string): void =>
    setGroupCollapsed(group, !collapsedGroups.includes(group))
  const toggleRow = (row: ItemRow): void => {
    if (row.type === 'group') {
      toggleGroup(row.group)
    } else {
      void toggle(row.node)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const itemRows = rows.filter(isItemRow)
    const index = itemRows.findIndex((row) => row.key === selectedKey)
    const current = itemRows[index]
    let next: ItemRow | undefined
    switch (event.key) {
      case 'ArrowDown':
        next = itemRows[Math.min(itemRows.length - 1, index + 1)]
        break
      case 'ArrowUp':
        next = itemRows[Math.max(0, index - 1)]
        break
      case 'ArrowRight':
        if (current && canExpand(current) && !current.expanded) {
          toggleRow(current)
        }
        break
      case 'ArrowLeft':
        if (current?.expanded) {
          toggleRow(current)
        }
        break
      case 'Enter':
        if (current?.type === 'group') {
          toggleGroup(current.group)
        } else if (current) {
          activate(current.node)
        }
        break
      default:
        return
    }
    event.preventDefault()
    if (next) {
      select(next.key)
      virtualizer.scrollToIndex(rows.indexOf(next))
    }
  }

  if (connections.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        {translate('database.explorer.noConnections', 'No connections yet.')}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      role="tree"
      tabIndex={0}
      aria-label={translate('database.explorer.label', 'Database objects')}
      onKeyDown={handleKeyDown}
      {...dropHandlers}
      className={cn(
        'h-full min-h-0 select-none overflow-auto scrollbar-sleek outline-none',
        dropTarget === TOP_LEVEL_DROP && 'ring-1 ring-inset ring-ring'
      )}
    >
      <div
        className="relative min-w-full"
        style={{ height: virtualizer.getTotalSize(), width: widest || undefined }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!
          return (
            <div
              key={row.key}
              data-row-key={row.key}
              className="absolute inset-x-0"
              style={{ height: EXPLORER_ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <DatabaseExplorerRow
                row={row}
                selected={row.key === selectedKey}
                dropTarget={row.type === 'group' && row.key === dropTarget}
                onSelect={select}
                onToggle={(node) => void toggle(node)}
                onToggleGroup={toggleGroup}
                onActivate={activate}
                onMeasure={onMeasure}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
