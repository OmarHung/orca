import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { openDatabaseTable } from '../database-page-actions'
import { DatabaseExplorerRow, EXPLORER_ROW_HEIGHT } from './DatabaseExplorerRow'
import { useDatabaseExplorerStore } from './database-explorer-store'
import {
  flattenDatabaseExplorer,
  type DatabaseExplorerRow as ExplorerRow
} from './database-explorer-rows'
import {
  connectionNode,
  isExpandableNode,
  type DatabaseExplorerNode
} from './database-explorer-tree'

type NodeRow = Extract<ExplorerRow, { type: 'node' }>

function isNodeRow(row: ExplorerRow | undefined): row is NodeRow {
  return row?.type === 'node'
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
  const { widest, onMeasure } = useWidestRow(rows)

  const activate = (node: DatabaseExplorerNode): void => {
    if (node.kind === 'relation') {
      openDatabaseTable(node.connectionId, node.schema, node.relation.name, node.database)
    } else {
      void toggle(node)
    }
  }

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
      className="h-full min-h-0 select-none overflow-auto scrollbar-sleek outline-none"
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
              className="absolute inset-x-0"
              style={{ height: EXPLORER_ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <DatabaseExplorerRow
                row={row}
                selected={row.key === selectedKey}
                onSelect={select}
                onToggle={(node) => void toggle(node)}
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
