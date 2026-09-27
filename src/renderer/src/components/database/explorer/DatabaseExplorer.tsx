import React, { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { DatabaseExplorerRow, EXPLORER_ROW_HEIGHT } from './DatabaseExplorerRow'
import { useDatabaseExplorerStore } from './database-explorer-store'
import {
  connectionNode,
  flattenDatabaseExplorer,
  isExpandableNode,
  type DatabaseExplorerRow as ExplorerRow
} from './database-explorer-tree'

type NodeRow = Extract<ExplorerRow, { type: 'node' }>

function isNodeRow(row: ExplorerRow | undefined): row is NodeRow {
  return row?.type === 'node'
}

export function DatabaseExplorer(): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const connections = useDatabaseConnectionsStore((state) => state.connections)
  const expanded = useDatabaseExplorerStore((state) => state.expanded)
  const children = useDatabaseExplorerStore((state) => state.children)
  const selectedKey = useDatabaseExplorerStore((state) => state.selectedKey)
  const select = useDatabaseExplorerStore((state) => state.select)
  const toggle = useDatabaseExplorerStore((state) => state.toggle)

  const rows = useMemo(
    () =>
      flattenDatabaseExplorer(
        connections.map((connection) => connectionNode(connection.id)),
        expanded,
        children
      ),
    [connections, expanded, children]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => EXPLORER_ROW_HEIGHT,
    overscan: 12
  })

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const nodeRows = rows.filter(isNodeRow)
    const index = nodeRows.findIndex((row) => row.key === selectedKey)
    const current = nodeRows[index]
    let next: NodeRow | undefined
    switch (event.key) {
      case 'ArrowDown':
        next = nodeRows[Math.min(nodeRows.length - 1, index + 1)]
        break
      case 'ArrowUp':
        next = nodeRows[Math.max(0, index - 1)]
        break
      case 'ArrowRight':
        if (current && isExpandableNode(current.node) && !current.expanded) {
          void toggle(current.node)
        }
        break
      case 'ArrowLeft':
        if (current?.expanded) {
          void toggle(current.node)
        }
        break
      case 'Enter':
        if (current) {
          void toggle(current.node)
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
      className="h-full min-h-0 overflow-auto scrollbar-sleek outline-none"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!
          return (
            <div
              key={row.key}
              className="absolute inset-x-0"
              style={{ height: EXPLORER_ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <DatabaseExplorerRow
                row={row}
                selected={row.key === selectedKey}
                onSelect={select}
                onToggle={(node) => void toggle(node)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
