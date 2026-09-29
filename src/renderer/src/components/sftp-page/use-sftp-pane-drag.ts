import type React from 'react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createMultiSelectDragGhost } from '../right-sidebar/file-explorer-multi-drag-image'
import type { SftpPaneId } from './sftp-columns-store'
import { resolveSftpDropDir } from './sftp-drop-target'

const DRAG_TYPE = 'application/x-orca-sftp-entries'

type DragHandlers = {
  onDragStart: React.DragEventHandler<HTMLElement>
  onDragOver: React.DragEventHandler<HTMLElement>
  onDragLeave: React.DragEventHandler<HTMLElement>
  onDragEnd: React.DragEventHandler<HTMLElement>
}

export type SftpPaneDrag = {
  handlers: DragHandlers
  /** The folder row that would take the drop. */
  dropTarget: string | null
  /** The drop would go to the folder the pane shows. */
  isPaneTarget: boolean
}

type PaneInput = {
  zoneRef: RefObject<HTMLElement | null>
  path: string | null
  selected: ReadonlySet<string>
}

type Dragged = { from: SftpPaneId; sources: string[] }
type Target = { pane: SftpPaneId; dir: string; isRow: boolean }

export type SftpPaneDropHandler = (
  from: SftpPaneId,
  sources: string[],
  to: SftpPaneId,
  dir: string
) => void

const PANES: readonly SftpPaneId[] = ['local', 'remote']

function closestData(target: EventTarget | null, attribute: string): string | null {
  const element = target instanceof Element ? target.closest<HTMLElement>(`[${attribute}]`) : null
  return element?.getAttribute(attribute) ?? null
}

function targetAt(
  source: Dragged,
  pane: SftpPaneId,
  eventTarget: EventTarget | null,
  shownPath: string | null
): Target | null {
  const rowDir = closestData(eventTarget, 'data-sftp-drop-dir')
  const dir = resolveSftpDropDir(source.from, source.sources, pane, rowDir, shownPath)
  return dir === null ? null : { pane, dir, isRow: dir === rowDir }
}

/**
 * Rows dragged between the panes upload or download; within the remote pane they move. The grabbed
 * row brings the selection when it is part of it. Rows are found by `data-sftp-entry`, folder and
 * ".." rows by `data-sftp-drop-dir`.
 */
export function useSftpPaneDrag(
  panes: Record<SftpPaneId, PaneInput>,
  onDrop: SftpPaneDropHandler
): Record<SftpPaneId, SftpPaneDrag> {
  const [target, setTarget] = useState<Target | null>(null)
  const dragged = useRef<Dragged | null>(null)
  const { local, remote } = panes

  // Why window capture: preload's document-level listener cancels and stops every drop that
  // isn't Orca's file drag, so React's delegated onDrop never sees it.
  useEffect(() => {
    const zones = { local: local.zoneRef, remote: remote.zoneRef }
    const paths = { local: local.path, remote: remote.path }
    const onWindowDrop = (event: DragEvent): void => {
      const source = dragged.current
      const into = PANES.find((pane) => {
        const zone = zones[pane].current
        return event.target instanceof Node && zone !== null && zone.contains(event.target)
      })
      if (!source || !into || !event.dataTransfer?.types.includes(DRAG_TYPE)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      dragged.current = null
      setTarget(null)
      const drop = targetAt(source, into, event.target, paths[into])
      if (drop !== null) {
        onDrop(source.from, source.sources, into, drop.dir)
      }
    }
    window.addEventListener('drop', onWindowDrop, true)
    return () => window.removeEventListener('drop', onWindowDrop, true)
  }, [local.path, local.zoneRef, onDrop, remote.path, remote.zoneRef])

  const bind = (pane: SftpPaneId): SftpPaneDrag => ({
    dropTarget: target?.pane === pane && target.isRow ? target.dir : null,
    isPaneTarget: target?.pane === pane && !target.isRow,
    handlers: {
      onDragStart: (event) => {
        const path = closestData(event.target, 'data-sftp-entry')
        if (path === null) {
          return
        }
        const { selected } = panes[pane]
        const sources = selected.has(path) ? [...selected] : [path]
        dragged.current = { from: pane, sources }
        event.dataTransfer.effectAllowed = 'copyMove'
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(sources))
        if (sources.length > 1 && event.target instanceof HTMLElement) {
          const ghost = createMultiSelectDragGhost(
            sources,
            event.target.getBoundingClientRect().width
          )
          document.body.appendChild(ghost)
          event.dataTransfer.setDragImage(ghost, 12, 12)
          setTimeout(() => ghost.remove(), 0)
        }
      },
      onDragOver: (event) => {
        const source = dragged.current
        if (!source || !event.dataTransfer.types.includes(DRAG_TYPE)) {
          return
        }
        const next = targetAt(source, pane, event.target, panes[pane].path)
        setTarget(next)
        if (next !== null) {
          event.preventDefault()
          event.dataTransfer.dropEffect = source.from === pane ? 'move' : 'copy'
        }
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node && event.currentTarget.contains(next))) {
          setTarget((current) => (current?.pane === pane ? null : current))
        }
      },
      onDragEnd: () => {
        dragged.current = null
        setTarget(null)
      }
    }
  })
  return { local: bind('local'), remote: bind('remote') }
}
