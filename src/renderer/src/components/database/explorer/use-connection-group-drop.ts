import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { moveDatabaseConnectionsToGroup } from '../database-connection-group-actions'
import { groupRowKey, type DatabaseExplorerRow } from './database-explorer-rows'

const DRAG_TYPE = 'application/x-orca-database-connection'
/** Drop target for the top level; group rows use their own keys. */
export const TOP_LEVEL_DROP = 'top-level'

type DragHandlers = {
  onDragStart: React.DragEventHandler<HTMLDivElement>
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDragEnd: React.DragEventHandler<HTMLDivElement>
}

type Dragged = { connectionId: string; group: string | null }

function rowAt(
  rowsByKey: ReadonlyMap<string, DatabaseExplorerRow>,
  target: EventTarget | null
): DatabaseExplorerRow | undefined {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-row-key]') : null
  return rowsByKey.get(element?.dataset.rowKey ?? '')
}

/** The group a drop at `target` files into: its row's group, or the top level off the rows. */
function groupAt(
  rowsByKey: ReadonlyMap<string, DatabaseExplorerRow>,
  target: EventTarget | null
): string | null {
  return rowAt(rowsByKey, target)?.group ?? null
}

// Why checked with the ref: a virtualized source row can unmount mid-drag and miss its dragend.
function carriesConnection(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(DRAG_TYPE) ?? false
}

/**
 * Dragging a connection onto a group, or any row inside it, files it there; dropping it anywhere
 * else in the tree moves it to the top level. Rows are found by their `data-row-key`.
 */
export function useConnectionGroupDrop(
  rows: readonly DatabaseExplorerRow[],
  treeRef: React.RefObject<HTMLElement | null>
): { dropTarget: string | null; handlers: DragHandlers } {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragged = useRef<Dragged | null>(null)
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])

  // Why window capture: preload's document-level listener cancels and stops every drop that
  // isn't Orca's file drag, so React's delegated onDrop never sees it.
  useEffect(() => {
    const onDrop = (event: DragEvent): void => {
      const source = dragged.current
      const tree = treeRef.current
      const inTree = event.target instanceof Node && tree !== null && tree.contains(event.target)
      if (!source || !inTree || !carriesConnection(event.dataTransfer)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const group = groupAt(rowsByKey, event.target)
      dragged.current = null
      setDropTarget(null)
      if (group !== source.group) {
        void moveDatabaseConnectionsToGroup([source.connectionId], group)
      }
    }
    window.addEventListener('drop', onDrop, true)
    return () => window.removeEventListener('drop', onDrop, true)
  }, [rowsByKey, treeRef])

  const handlers: DragHandlers = {
    onDragStart: (event) => {
      const row = rowAt(rowsByKey, event.target)
      if (row?.type !== 'node' || row.node.kind !== 'connection') {
        return
      }
      dragged.current = { connectionId: row.node.connectionId, group: row.group }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(DRAG_TYPE, row.node.connectionId)
    },
    onDragOver: (event) => {
      const source = dragged.current
      if (!source || !carriesConnection(event.dataTransfer)) {
        return
      }
      const group = groupAt(rowsByKey, event.target)
      if (group === source.group) {
        setDropTarget(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(group === null ? TOP_LEVEL_DROP : groupRowKey(group))
    },
    onDragLeave: (event) => {
      const next = event.relatedTarget
      if (!(next instanceof Node && event.currentTarget.contains(next))) {
        setDropTarget(null)
      }
    },
    onDragEnd: () => {
      dragged.current = null
      setDropTarget(null)
    }
  }
  return { dropTarget, handlers }
}
