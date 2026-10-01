import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'

// Why stable host nodes: the run terminal is portaled into its own node, and only that node moves
// between the Run panel and a hidden parking spot. Portaling straight into the panel would remount
// xterm every time the panel opens or closes.
const hosts = new Map<string, HTMLDivElement>()
let parking: HTMLDivElement | null = null

function parkingContainer(): HTMLDivElement {
  if (!parking?.isConnected) {
    parking = document.createElement('div')
    parking.dataset.runPanelParking = ''
    parking.style.display = 'none'
    document.body.appendChild(parking)
  }
  return parking
}

/** The node a run terminal renders into; created parked (hidden) on first use. */
export function runPanelTerminalHost(tabId: string): HTMLDivElement {
  const existing = hosts.get(tabId)
  if (existing) {
    return existing
  }
  const host = document.createElement('div')
  host.dataset.runPanelTerminalTabId = tabId
  // Same box as RetainedPaneHost gives a tab-group terminal.
  Object.assign(host.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    minWidth: '0',
    minHeight: '0',
    overflow: 'hidden',
    isolation: 'isolate'
  })
  hosts.set(tabId, host)
  parkingContainer().appendChild(host)
  return host
}

/** Moves a run terminal into the panel; the returned cleanup parks it again. */
export function showRunPanelTerminalHost(tabId: string, container: HTMLElement): () => void {
  const host = runPanelTerminalHost(tabId)
  container.appendChild(host)
  // Why next frame: xterm can only measure once the node has the panel's size.
  const frame = requestAnimationFrame(() => {
    window.dispatchEvent(new Event(SYNC_FIT_PANES_EVENT))
  })
  return () => {
    cancelAnimationFrame(frame)
    if (host.parentElement === container) {
      parkingContainer().appendChild(host)
    }
  }
}

/** Drops hosts whose run terminal no longer belongs to the Run panel. */
export function releaseRunPanelTerminalHosts(keepTabIds: ReadonlySet<string>): void {
  for (const [tabId, host] of hosts) {
    if (!keepTabIds.has(tabId)) {
      host.remove()
      hosts.delete(tabId)
    }
  }
}
