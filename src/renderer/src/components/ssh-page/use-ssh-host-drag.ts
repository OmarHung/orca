import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveSshHostDrop, type SshHostDragItem, type SshHostDrop } from './ssh-host-drop-target'
import { sshHostGroupActions, useSshHostGroups } from './ssh-host-groups-store'
import { UNGROUPED_ROW_KEY, type SshHostTreeRow } from './ssh-host-tree'

const DRAG_TYPE = 'application/x-orca-ssh-host-tree'
// Why: rows carry it as `data-ssh-tree-row={row.key}` (SshHostTreeRows).
const SSH_TREE_ROW_ATTRIBUTE = 'data-ssh-tree-row'

type DragHandlers = {
  onDragStart: React.DragEventHandler<HTMLDivElement>
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDragEnd: React.DragEventHandler<HTMLDivElement>
}

function rowElementAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>(`[${SSH_TREE_ROW_ATTRIBUTE}]`)
    : null
}

function dragItemOf(row: SshHostTreeRow | undefined): SshHostDragItem | null {
  if (row?.kind === 'host') {
    return { kind: 'host', targetId: row.target.id, groupId: row.groupId }
  }
  return row?.kind === 'group' ? { kind: 'group', groupId: row.group.id } : null
}

function resolveDropAt(
  event: { target: EventTarget | null; clientY: number },
  item: SshHostDragItem | null,
  rowsByKey: ReadonlyMap<string, SshHostTreeRow>
): SshHostDrop | null {
  if (!item) {
    return null
  }
  const element = rowElementAt(event.target)
  const row = rowsByKey.get(element?.getAttribute(SSH_TREE_ROW_ATTRIBUTE) ?? '') ?? null
  const rect = element?.getBoundingClientRect()
  const offsetRatio = rect && rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
  return resolveSshHostDrop({
    data: useSshHostGroups.getState().data,
    item,
    row,
    offsetRatio,
    rootKey: rowsByKey.has(UNGROUPED_ROW_KEY) ? UNGROUPED_ROW_KEY : null
  })
}

function isSameDrop(a: SshHostDrop | null, b: SshHostDrop | null): boolean {
  return a?.indicatorKey === b?.indicatorKey && a?.indicator === b?.indicator
}

/**
 * Drag a host onto a group (or any host inside it) to file it there, or onto the ungrouped
 * heading to take it out. Dragging a group onto another group's middle nests it; its top or
 * bottom edge places it before or after. Rows are found by their SSH_TREE_ROW_ATTRIBUTE.
 */
export function useSshHostDrag(
  rows: readonly SshHostTreeRow[],
  listRef: React.RefObject<HTMLElement | null>
): { drop: SshHostDrop | null; handlers: DragHandlers } {
  const [drop, setDrop] = useState<SshHostDrop | null>(null)
  const dragged = useRef<SshHostDragItem | null>(null)
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])

  // Why window capture: preload's document-level listener cancels and stops every drop that
  // isn't Orca's file drag, so React's delegated onDrop never sees it.
  useEffect(() => {
    const onDrop = (event: DragEvent): void => {
      const item = dragged.current
      const list = listRef.current
      const inList = event.target instanceof Node && list !== null && list.contains(event.target)
      if (!item || !inList || !event.dataTransfer?.types.includes(DRAG_TYPE)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const landing = resolveDropAt(event, item, rowsByKey)
      dragged.current = null
      setDrop(null)
      if (!landing) {
        return
      }
      if (item.kind === 'host') {
        sshHostGroupActions.moveHosts([item.targetId], landing.placement.groupId)
      } else {
        sshHostGroupActions.moveGroup(item.groupId, landing.placement)
      }
    }
    window.addEventListener('drop', onDrop, true)
    return () => window.removeEventListener('drop', onDrop, true)
  }, [listRef, rowsByKey])

  const handlers: DragHandlers = {
    onDragStart: (event) => {
      const element = rowElementAt(event.target)
      const item = dragItemOf(rowsByKey.get(element?.getAttribute(SSH_TREE_ROW_ATTRIBUTE) ?? ''))
      if (!item) {
        return
      }
      dragged.current = item
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(DRAG_TYPE, item.kind === 'host' ? item.targetId : item.groupId)
    },
    onDragOver: (event) => {
      if (!dragged.current || !event.dataTransfer.types.includes(DRAG_TYPE)) {
        return
      }
      const next = resolveDropAt(event, dragged.current, rowsByKey)
      setDrop((current) => (isSameDrop(current, next) ? current : next))
      if (next) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }
    },
    onDragLeave: (event) => {
      const next = event.relatedTarget
      if (!(next instanceof Node && event.currentTarget.contains(next))) {
        setDrop(null)
      }
    },
    onDragEnd: () => {
      dragged.current = null
      setDrop(null)
    }
  }
  return { drop, handlers }
}
