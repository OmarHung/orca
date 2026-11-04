import type { SshTarget } from '../../../../shared/ssh-types'
import type { RemoteSession } from './remote-session-store'

export const MAX_REMOTE_GRID_TABS = 9

/** Below this a shell wraps too much to read, so the grid gives up a column instead. */
const MIN_REMOTE_GRID_PANE_WIDTH = 360

/** Percentages of the terminal area, so a pane moves without its terminal being remounted. */
export type RemoteGridCell = { top: number; left: number; width: number; height: number }

function preferredColumns(count: number): number {
  if (count <= 2) {
    return count
  }
  return count <= 4 ? 2 : 3
}

/** 2 side by side, 4 as 2×2, 9 as 3×3. A short last row shares the full width. */
export function remoteGridCells(count: number, containerWidth: number): RemoteGridCell[] {
  if (count <= 0) {
    return []
  }
  const fitting = Math.max(1, Math.floor(containerWidth / MIN_REMOTE_GRID_PANE_WIDTH))
  // Why: before the first measurement the width is 0, which says nothing about the space there is.
  const columns =
    containerWidth > 0 ? Math.min(preferredColumns(count), fitting) : preferredColumns(count)
  const rows = Math.ceil(count / columns)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const inRow = row === rows - 1 ? count - row * columns : columns
    return {
      top: (row / rows) * 100,
      left: ((index % columns) / inRow) * 100,
      width: 100 / inRow,
      height: 100 / rows
    }
  })
}

/** How to get each host into the grid; hosts already running a terminal never get a second ssh. */
export type RemoteGridHostStep =
  | { kind: 'reuse'; tabId: string }
  | { kind: 'start'; tabId: string; target: SshTarget }
  | { kind: 'open'; target: SshTarget }

function tabOnHost(
  targetId: string,
  tabIds: readonly string[],
  sessions: Readonly<Record<string, RemoteSession>>,
  gridTabIds: readonly string[]
): { tabId: string; terminalStarted: boolean } | null {
  const onHost = tabIds.filter((tabId) => sessions[tabId]?.targetId === targetId)
  const running = onHost.filter((tabId) => sessions[tabId]?.terminalStarted)
  const best = running.find((tabId) => gridTabIds.includes(tabId)) ?? running[0] ?? onHost[0]
  return best ? { tabId: best, terminalStarted: sessions[best]?.terminalStarted === true } : null
}

export function planRemoteGridHosts(
  targets: readonly SshTarget[],
  tabIds: readonly string[],
  sessions: Readonly<Record<string, RemoteSession>>,
  gridTabIds: readonly string[]
): RemoteGridHostStep[] {
  return targets.map((target) => {
    const existing = tabOnHost(target.id, tabIds, sessions, gridTabIds)
    if (!existing) {
      return { kind: 'open', target }
    }
    return existing.terminalStarted
      ? { kind: 'reuse', tabId: existing.tabId }
      : { kind: 'start', tabId: existing.tabId, target }
  })
}
