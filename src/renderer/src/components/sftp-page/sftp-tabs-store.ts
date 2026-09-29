import { create } from 'zustand'
import { createBrowserUuid } from '@/lib/browser-uuid'

export type SftpTab = { id: string; targetId: string; label: string }

type PersistedTabs = { tabs: SftpTab[]; activeTabId: string | null }

type SftpTabsState = PersistedTabs & {
  /** Remote folder each tab shows; not saved, since a tab reopens at the host's home. */
  remotePathByTab: Readonly<Record<string, string>>
  openTab: (target: { id: string; label: string }) => string
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
    openTab: (target) => {
      const tab: SftpTab = { id: createBrowserUuid(), targetId: target.id, label: target.label }
      update({ tabs: [...get().tabs, tab], activeTabId: tab.id })
      return tab.id
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
