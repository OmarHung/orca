import type { Terminal } from '@xterm/xterm'
import { getTerminalTabXterm } from '../terminal-pane/terminal-pane-manager-registry'

const CHECK_MS = 500

/**
 * Keeps one attachment on each tab's terminal, and returns the function that stops them all. Checks
 * on a timer, since a pane can mount, split or unsplit with nothing announcing it.
 */
export function watchTabTerminals(
  tabIds: readonly string[],
  attach: (tabId: string, terminal: Terminal) => () => void,
  /** The tab's terminal changed while watched, so what happened in between went unseen. */
  onTerminalLost?: (tabId: string) => void
): () => void {
  const attached = new Map<string, { terminal: Terminal; stop: () => void }>()
  const check = (): void => {
    for (const [tabId, attachment] of attached) {
      if (getTerminalTabXterm(tabId) !== attachment.terminal) {
        attachment.stop()
        attached.delete(tabId)
        onTerminalLost?.(tabId)
      }
    }
    for (const tabId of tabIds) {
      const terminal = getTerminalTabXterm(tabId)
      if (terminal && !attached.has(tabId)) {
        attached.set(tabId, { terminal, stop: attach(tabId, terminal) })
      }
    }
  }
  check()
  const timer = setInterval(check, CHECK_MS)
  return () => {
    clearInterval(timer)
    for (const attachment of attached.values()) {
      attachment.stop()
    }
  }
}
