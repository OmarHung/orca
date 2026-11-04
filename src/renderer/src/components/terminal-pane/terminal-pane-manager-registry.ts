import type { Terminal } from '@xterm/xterm'
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

/** The tab's terminal, or null when it isn't mounted or holds several panes. */
export function getTerminalTabXterm(tabId: string): Terminal | null {
  const panes = managers.get(tabId)?.getPanes() ?? []
  return panes.length === 1 ? panes[0].terminal : null
}

type CursorLineBuffer = {
  baseY: number
  cursorY: number
  getLine: (
    row: number
  ) => { isWrapped: boolean; translateToString: (trimRight?: boolean) => string } | undefined
}

/** The text of the line the cursor is on, including any rows it wrapped from. */
export function readBufferCursorLine(buffer: CursorLineBuffer): string {
  const parts: string[] = []
  for (let row = buffer.baseY + buffer.cursorY; row >= 0; row -= 1) {
    const line = buffer.getLine(row)
    if (!line) {
      break
    }
    parts.unshift(line.translateToString(parts.length === 0))
    if (!line.isWrapped) {
      break
    }
  }
  return parts.join('')
}

/** Null when the tab has no mounted terminal. */
export function readTerminalTabCursorLine(tabId: string): string | null {
  const manager = managers.get(tabId)
  const buffer = (manager?.getActivePane() ?? manager?.getPanes()[0])?.terminal.buffer.active
  return buffer ? readBufferCursorLine(buffer) : null
}

/** Input reaching a terminal without passing xterm's onData, for whoever must stay in step with it. */
export type TerminalDirectInputObserver = {
  /** A key the terminal's shortcut handling turned into bytes, such as Cmd+Backspace. */
  onShortcutInput: (ptyId: string, data: string) => void
  /** Anything else typed in by a program, a paste, or a drop. */
  onOtherInput: (ptyId: string, data: string) => void
}

let directInputObserver: TerminalDirectInputObserver | null = null

export function observeTerminalDirectInput(observer: TerminalDirectInputObserver): () => void {
  directInputObserver = observer
  return () => {
    if (directInputObserver === observer) {
      directInputObserver = null
    }
  }
}

export function reportTerminalShortcutInput(ptyId: string, data: string): void {
  directInputObserver?.onShortcutInput(ptyId, data)
}

export function reportTerminalOtherInput(ptyId: string | null | undefined, data: string): void {
  if (ptyId) {
    directInputObserver?.onOtherInput(ptyId, data)
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
