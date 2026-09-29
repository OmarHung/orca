import { create } from 'zustand'
import { createBrowserUuid } from '@/lib/browser-uuid'

export type SftpTab = { id: string; targetId: string; label: string }

type SftpTabTarget = { id: string; label: string }

type PersistedTabs = { tabs: SftpTab[]; activeTabId: string | null }

type SftpTabsState = PersistedTabs & {
  /** Remote folder each tab shows; not saved, since a tab reopens at the host's home. */
  remotePathByTab: Readonly<Record<string, string>>
  /** Opens a new tab at the end, or right after `afterTabId`. */
  openTab: (target: SftpTabTarget, afterTabId?: string) => string
  /** Goes to a tab already on this host (the active one first), opening one only if none is. */
  showHost: (target: SftpTabTarget) => string
  activateTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  setTabRemotePath: (tabId: string, path: string) => void
}

// Why localStorage: which hosts were open is a per-device layout choice, like column widths.
const STORAGE_KEY = 'orca.sftpTabs'

function isTab(value: unknown): value is SftpTab {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const tab: Record<string, unknown> = { ...value }
  return (
    typeof tab.id === 'string' && typeof tab.targetId === 'string' && typeof tab.label === 'string'
  )
}

function readPersisted(): PersistedTabs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed === 'object' && parsed !== null) {
      const stored: Record<string, unknown> = { ...parsed }
      const tabs = Array.isArray(stored.tabs) ? stored.tabs.filter(isTab) : []
      const activeTabId = tabs.some((tab) => tab.id === stored.activeTabId)
        ? String(stored.activeTabId)
        : (tabs[0]?.id ?? null)
      return { tabs, activeTabId }
    }
  } catch {
    // Corrupt or unavailable storage starts with no tabs.
  }
  return { tabs: [], activeTabId: null }
}

function writePersisted(value: PersistedTabs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; tabs just won't survive a restart.
  }
}

/** Closing the active tab moves to its right neighbour, else its left one. */
function nextActiveAfterClose(tabs: readonly SftpTab[], closedId: string): string | null {
  const index = tabs.findIndex((tab) => tab.id === closedId)
  return (tabs[index + 1] ?? tabs[index - 1])?.id ?? null
}

/** Open SFTP tabs, one workbench each; several may point at the same host. */
export const useSftpTabsStore = create<SftpTabsState>((set, get) => {
  const update = (next: PersistedTabs): void => {
    set(next)
    writePersisted(next)
  }
  return {
    ...readPersisted(),
    remotePathByTab: {},
    openTab: (target, afterTabId) => {
      const tab: SftpTab = { id: createBrowserUuid(), targetId: target.id, label: target.label }
      const { tabs } = get()
      const afterIndex = tabs.findIndex((existing) => existing.id === afterTabId)
      const insertAt = afterIndex === -1 ? tabs.length : afterIndex + 1
      update({
        tabs: [...tabs.slice(0, insertAt), tab, ...tabs.slice(insertAt)],
        activeTabId: tab.id
      })
      return tab.id
    },
    showHost: (target) => {
      const { tabs, activeTabId, openTab, activateTab } = get()
      const onHost = tabs.filter((tab) => tab.targetId === target.id)
      const shown = onHost.find((tab) => tab.id === activeTabId) ?? onHost[0]
      if (!shown) {
        return openTab(target)
      }
      activateTab(shown.id)
      return shown.id
    },
    activateTab: (tabId) => {
      if (get().tabs.some((tab) => tab.id === tabId)) {
        update({ tabs: get().tabs, activeTabId: tabId })
      }
    },
    closeTab: (tabId) => {
      const { tabs, activeTabId } = get()
      update({
        tabs: tabs.filter((tab) => tab.id !== tabId),
        activeTabId: activeTabId === tabId ? nextActiveAfterClose(tabs, tabId) : activeTabId
      })
      const { [tabId]: _closed, ...remaining } = get().remotePathByTab
      set({ remotePathByTab: remaining })
    },
    setTabRemotePath: (tabId, path) => {
      if (get().remotePathByTab[tabId] !== path) {
        set({ remotePathByTab: { ...get().remotePathByTab, [tabId]: path } })
      }
    }
  }
})
