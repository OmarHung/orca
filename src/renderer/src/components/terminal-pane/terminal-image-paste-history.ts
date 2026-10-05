import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { isImageDropPath } from './terminal-drop-image-path'

/** An image path Orca pasted or dropped into a terminal. Claude only writes a
 *  chip's image to its transcript on submit, so an unsent `[Image #N]` can only
 *  be previewed from this record. */
export type TerminalImagePaste = {
  path: string
  /** SSH connection that owns `path`; null for a local file. */
  connectionId: string | null
  pastedAt: number
  /** The pane agent's session at paste time; Claude restarts `#N` per session. */
  sessionId: string | null
}

const MAX_PASTES_PER_PANE = 32
const MAX_TRACKED_PANES = 64
const pastesByPaneKey = new Map<string, readonly TerminalImagePaste[]>()

export function recordTerminalImagePaste(paneKey: string, paste: TerminalImagePaste): void {
  const existing = pastesByPaneKey.get(paneKey) ?? []
  // Re-insert so Map order tracks recency and the stalest pane is evicted first.
  pastesByPaneKey.delete(paneKey)
  pastesByPaneKey.set(paneKey, [...existing, paste].slice(-MAX_PASTES_PER_PANE))
  if (pastesByPaneKey.size > MAX_TRACKED_PANES) {
    const stalest = pastesByPaneKey.keys().next().value
    if (stalest !== undefined) {
      pastesByPaneKey.delete(stalest)
    }
  }
}

export function listTerminalImagePastes(paneKey: string): readonly TerminalImagePaste[] {
  return pastesByPaneKey.get(paneKey) ?? []
}

export function recordTerminalImagePastesForLeaf(args: {
  tabId: string
  leafId: string
  paths: readonly string[]
  connectionId: string | null
}): void {
  let paneKey: string
  try {
    paneKey = makePaneKey(args.tabId, args.leafId)
  } catch {
    // A legacy non-UUID leaf has no agent-status identity to scope pastes by.
    return
  }
  const sessionId =
    useAppStore.getState().agentStatusByPaneKey[paneKey]?.providerSession?.id ?? null
  const pastedAt = Date.now()
  for (const path of args.paths) {
    recordTerminalImagePaste(paneKey, {
      path,
      connectionId: args.connectionId,
      pastedAt,
      sessionId
    })
  }
}

/** Records the image paths of a drop that reached the terminal. Agent TUIs turn
 *  each into a chip just like a clipboard paste, so they share one numbering. */
export function recordTerminalImageDrops(
  drop: {
    tabId: string
    pane: { leafId: string }
    paths: readonly string[]
    /** SSH target the paths live on; absent or null for local drops. */
    connectionId?: string | null
  },
  pathsWritten: number
): void {
  const paths = drop.paths.slice(0, pathsWritten).filter(isImageDropPath)
  if (paths.length > 0) {
    recordTerminalImagePastesForLeaf({
      tabId: drop.tabId,
      leafId: drop.pane.leafId,
      paths,
      connectionId: drop.connectionId ?? null
    })
  }
}

export function resetTerminalImagePasteHistoryForTests(): void {
  pastesByPaneKey.clear()
}
