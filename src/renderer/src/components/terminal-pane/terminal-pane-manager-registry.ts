import type { PaneManager } from '@/lib/pane-manager/pane-manager'

export type TerminalTabScreen = { paneCount: number; isFullScreen: boolean }

const managers = new Map<string, PaneManager>()

export function registerTerminalPaneManager(tabId: string, manager: PaneManager): void {
  managers.set(tabId, manager)
}

/** Only for the manager still on record: a remount may already have replaced it. */
export function unregisterTerminalPaneManager(tabId: string, manager: PaneManager): void {
  if (managers.get(tabId) === manager) {
    managers.delete(tabId)
  }
}

/** What a tab's terminal shows right now; null while it isn't mounted, so nothing is known. */
export function readTerminalTabScreen(tabId: string): TerminalTabScreen | null {
  const manager = managers.get(tabId)
  if (!manager) {
    return null
  }
  const panes = manager.getPanes()
  const pane = manager.getActivePane() ?? panes[0]
  return {
    paneCount: panes.length,
    isFullScreen: pane?.terminal.buffer.active.type === 'alternate'
  }
}
