import { create } from 'zustand'
import {
  newConsoleTab,
  newTableTab,
  readPersistedTab,
  type DatabaseConsoleTab,
  type DatabaseTab,
  type DatabaseTableTab
} from './database-page-tabs'

export type { DatabaseConsoleTab, DatabaseTab, DatabaseTableTab } from './database-page-tabs'

const STORAGE_KEY = 'orca.database.page.v1'

export const DATABASE_EXPLORER_WIDTH = { min: 180, fallback: 280, max: 800 }
export const DATABASE_RESULTS_HEIGHT = { min: 80, fallback: 280, max: 2000 }
export const DATABASE_VALUE_VIEWER_WIDTH = { min: 180, fallback: 320, max: 1600 }

type PersistedDatabasePage = {
  tabs: DatabaseTab[]
  activeTabId: string | null
  explorerWidth: number
  resultsHeight: number
  valueViewerOpen: boolean
  valueViewerWidth: number
}

type DatabasePageState = PersistedDatabasePage & {
  /** Opens a new console for the connection and focuses it. */
  openConsole: (connectionId: string, connectionName: string) => DatabaseConsoleTab
  /** Focuses the table's data tab, opening one if needed. */
  openTable: (connectionId: string, schema: string, relation: string) => DatabaseTableTab
  updateTableQuery: (tabId: string, query: { where: string; orderBy: string }) => void
  activateTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  closeTabsForConnection: (connectionId: string) => DatabaseTab[]
  setExplorerWidth: (width: number) => void
  setResultsHeight: (height: number) => void
  toggleValueViewer: () => void
  setValueViewerWidth: (width: number) => void
}

function clamp(value: unknown, limits: { min: number; fallback: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return limits.fallback
  }
  return Math.min(limits.max, Math.max(limits.min, value))
}

function readPersisted(): PersistedDatabasePage {
  let parsed: Record<string, unknown> = {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (typeof value === 'object' && value !== null) {
      parsed = { ...value }
    }
  } catch {
    // Corrupt or unavailable storage falls back to defaults.
  }
  const tabs = Array.isArray(parsed.tabs)
    ? parsed.tabs.flatMap((tab: unknown) => readPersistedTab(tab) ?? [])
    : []
  const activeTabId =
    typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : (tabs[0]?.id ?? null)
  return {
    tabs,
    activeTabId,
    explorerWidth: clamp(parsed.explorerWidth, DATABASE_EXPLORER_WIDTH),
    resultsHeight: clamp(parsed.resultsHeight, DATABASE_RESULTS_HEIGHT),
    valueViewerOpen: parsed.valueViewerOpen === true,
    valueViewerWidth: clamp(parsed.valueViewerWidth, DATABASE_VALUE_VIEWER_WIDTH)
  }
}

function writePersisted(state: PersistedDatabasePage): void {
  const persisted: PersistedDatabasePage = {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    explorerWidth: state.explorerWidth,
    resultsHeight: state.resultsHeight,
    valueViewerOpen: state.valueViewerOpen,
    valueViewerWidth: state.valueViewerWidth
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    // Storage can be unavailable; the layout just won't survive a reload.
  }
}

function nextConsoleTitle(tabs: DatabaseTab[], connectionName: string): string {
  const taken = new Set(tabs.map((tab) => tab.title))
  if (!taken.has(connectionName)) {
    return connectionName
  }
  let index = 2
  while (taken.has(`${connectionName} (${index})`)) {
    index += 1
  }
  return `${connectionName} (${index})`
}

function neighbourAfterClose(tabs: DatabaseTab[], closedId: string): string | null {
  const index = tabs.findIndex((tab) => tab.id === closedId)
  const remaining = tabs.filter((tab) => tab.id !== closedId)
  return remaining[Math.min(index, remaining.length - 1)]?.id ?? null
}

export const useDatabasePageStore = create<DatabasePageState>((set, get) => {
  const update = (patch: Partial<PersistedDatabasePage>): void => {
    set(patch)
    writePersisted(get())
  }
  return {
    ...readPersisted(),
    openConsole: (connectionId, connectionName) => {
      const tab = newConsoleTab(connectionId, nextConsoleTitle(get().tabs, connectionName))
      update({ tabs: [...get().tabs, tab], activeTabId: tab.id })
      return tab
    },
    openTable: (connectionId, schema, relation) => {
      const existing = get().tabs.find(
        (tab): tab is DatabaseTableTab =>
          tab.kind === 'table' &&
          tab.connectionId === connectionId &&
          tab.schema === schema &&
          tab.relation === relation
      )
      if (existing) {
        update({ activeTabId: existing.id })
        return existing
      }
      const tab = newTableTab(connectionId, schema, relation)
      update({ tabs: [...get().tabs, tab], activeTabId: tab.id })
      return tab
    },
    updateTableQuery: (tabId, query) =>
      update({
        tabs: get().tabs.map((tab) =>
          tab.id === tabId && tab.kind === 'table' ? { ...tab, ...query } : tab
        )
      }),
    activateTab: (tabId) => update({ activeTabId: tabId }),
    closeTab: (tabId) => {
      const { tabs, activeTabId } = get()
      update({
        tabs: tabs.filter((tab) => tab.id !== tabId),
        activeTabId: activeTabId === tabId ? neighbourAfterClose(tabs, tabId) : activeTabId
      })
    },
    closeTabsForConnection: (connectionId) => {
      const { tabs, activeTabId } = get()
      const closed = tabs.filter((tab) => tab.connectionId === connectionId)
      const remaining = tabs.filter((tab) => tab.connectionId !== connectionId)
      update({
        tabs: remaining,
        activeTabId: remaining.some((tab) => tab.id === activeTabId)
          ? activeTabId
          : (remaining[0]?.id ?? null)
      })
      return closed
    },
    setExplorerWidth: (width) => update({ explorerWidth: clamp(width, DATABASE_EXPLORER_WIDTH) }),
    setResultsHeight: (height) => update({ resultsHeight: clamp(height, DATABASE_RESULTS_HEIGHT) }),
    toggleValueViewer: () => update({ valueViewerOpen: !get().valueViewerOpen }),
    setValueViewerWidth: (width) =>
      update({ valueViewerWidth: clamp(width, DATABASE_VALUE_VIEWER_WIDTH) })
  }
})
