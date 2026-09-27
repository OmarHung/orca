import { create } from 'zustand'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { DATABASE_CONNECTION_ID_PATTERN } from '../../../../shared/database/database-connection-types'
import { DATABASE_CONSOLE_ID_PATTERN } from '../../../../shared/database/database-session-types'

const STORAGE_KEY = 'orca.database.page.v1'

export const DATABASE_EXPLORER_WIDTH = { min: 180, fallback: 280, max: 800 }
export const DATABASE_RESULTS_HEIGHT = { min: 80, fallback: 280, max: 2000 }

export type DatabaseConsoleTab = {
  id: string
  connectionId: string
  consoleId: string
  title: string
}

type PersistedDatabasePage = {
  tabs: DatabaseConsoleTab[]
  activeTabId: string | null
  explorerWidth: number
  resultsHeight: number
}

type DatabasePageState = PersistedDatabasePage & {
  /** Opens a new console for the connection and focuses it. */
  openConsole: (connectionId: string, connectionName: string) => DatabaseConsoleTab
  activateTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  closeTabsForConnection: (connectionId: string) => DatabaseConsoleTab[]
  setExplorerWidth: (width: number) => void
  setResultsHeight: (height: number) => void
}

function clamp(value: unknown, limits: { min: number; fallback: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return limits.fallback
  }
  return Math.min(limits.max, Math.max(limits.min, value))
}

function readTab(value: unknown): DatabaseConsoleTab | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const id: unknown = Reflect.get(value, 'id')
  const connectionId: unknown = Reflect.get(value, 'connectionId')
  const consoleId: unknown = Reflect.get(value, 'consoleId')
  const title: unknown = Reflect.get(value, 'title')
  if (
    typeof id !== 'string' ||
    typeof connectionId !== 'string' ||
    !DATABASE_CONNECTION_ID_PATTERN.test(connectionId) ||
    typeof consoleId !== 'string' ||
    !DATABASE_CONSOLE_ID_PATTERN.test(consoleId) ||
    typeof title !== 'string'
  ) {
    return null
  }
  return { id, connectionId, consoleId, title }
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
    ? parsed.tabs.flatMap((tab: unknown) => readTab(tab) ?? [])
    : []
  const activeTabId =
    typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : (tabs[0]?.id ?? null)
  return {
    tabs,
    activeTabId,
    explorerWidth: clamp(parsed.explorerWidth, DATABASE_EXPLORER_WIDTH),
    resultsHeight: clamp(parsed.resultsHeight, DATABASE_RESULTS_HEIGHT)
  }
}

function writePersisted(state: PersistedDatabasePage): void {
  const persisted: PersistedDatabasePage = {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    explorerWidth: state.explorerWidth,
    resultsHeight: state.resultsHeight
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    // Storage can be unavailable; the layout just won't survive a reload.
  }
}

function nextConsoleTitle(tabs: DatabaseConsoleTab[], connectionName: string): string {
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

function neighbourAfterClose(tabs: DatabaseConsoleTab[], closedId: string): string | null {
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
      const tab: DatabaseConsoleTab = {
        id: createBrowserUuid(),
        connectionId,
        consoleId: createBrowserUuid(),
        title: nextConsoleTitle(get().tabs, connectionName)
      }
      update({ tabs: [...get().tabs, tab], activeTabId: tab.id })
      return tab
    },
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
    setResultsHeight: (height) => update({ resultsHeight: clamp(height, DATABASE_RESULTS_HEIGHT) })
  }
})
