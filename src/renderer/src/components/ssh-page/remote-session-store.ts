import { z } from 'zod'
import { create } from 'zustand'
import { MAX_REMOTE_GRID_TABS } from './remote-grid'

export type RemoteLayout = 'terminal' | 'split' | 'files'

/** One tab of the SSH page: a terminal and a file workbench on the same host. */
export type RemoteSession = {
  /** The terminal tab in the SSH sessions workspace. */
  tabId: string
  /** Empty for tabs from before sessions whose host could not be identified. */
  targetId: string
  layout: RemoteLayout
  /** Height of the files area in the split layout. */
  dockHeight: number
  /** False until the user confirms the ssh command; no TerminalPane or PTY exists before that. */
  terminalStarted: boolean
}

type NewRemoteSession = Omit<RemoteSession, 'dockHeight'>

/** Tabs shown side by side. Only changes what the terminal area shows: each tab stays one host. */
export type RemoteGrid = { tabIds: readonly string[]; layout: RemoteLayout; dockHeight: number }

type RemoteSessionState = {
  sessions: Readonly<Record<string, RemoteSession>>
  /** Remote folder each tab shows; not saved, since a tab reopens at the host's home. */
  remotePathByTab: Readonly<Record<string, string>>
  /** Remote items selected in each tab's files pane; not saved, like the folder. */
  remoteSelectionByTab: Readonly<Record<string, readonly string[]>>
  grid: RemoteGrid | null
  addSession: (session: NewRemoteSession) => void
  setLayout: (tabId: string, layout: RemoteLayout) => void
  setDockHeight: (tabId: string, dockHeight: number) => void
  markTerminalStarted: (tabId: string) => void
  /** The terminal ended but the tab stays for its files; connecting again starts a new one. */
  markTerminalStopped: (tabId: string) => void
  setTargetId: (tabId: string, targetId: string) => void
  setRemotePath: (tabId: string, path: string) => void
  setRemoteSelection: (tabId: string, paths: readonly string[]) => void
  /** Adds to the grid, or starts one if this makes two; a grid of one is just a tab. */
  addToGrid: (tabIds: readonly string[]) => void
  /** Stops showing a tab in the grid. The tab and its ssh keep running. */
  removeFromGrid: (tabId: string) => void
  clearGrid: () => void
  /** Forgets every tab that is no longer open. */
  prune: (openTabIds: ReadonlySet<string>) => void
}

export const DEFAULT_REMOTE_DOCK_HEIGHT = 280

// Why localStorage: which layout a tab shows is a per-device choice, like column widths.
const STORAGE_KEY = 'orca.remoteSessions'
const LEGACY_SFTP_TABS_KEY = 'orca.sftpTabs'

const LayoutSchema = z.enum(['terminal', 'split', 'files'])

const SessionSchema = z.object({
  tabId: z.string().min(1),
  targetId: z.string(),
  layout: LayoutSchema,
  dockHeight: z.number().positive(),
  terminalStarted: z.boolean()
})

const GridSchema = z.object({
  tabIds: z.array(z.string().min(1)).min(2).max(MAX_REMOTE_GRID_TABS),
  layout: LayoutSchema,
  dockHeight: z.number().positive()
})

// Why optional: saves from before grids have none, and must still bring their sessions back.
const StoredSessionsSchema = z.object({
  sessions: z.array(z.unknown()),
  grid: z.unknown().optional()
})

type PersistedSessions = {
  sessions: Record<string, RemoteSession>
  grid: RemoteGrid | null
}

function readPersisted(): PersistedSessions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const stored = StoredSessionsSchema.safeParse(raw ? JSON.parse(raw) : null)
    if (!stored.success) {
      return { sessions: {}, grid: null }
    }
    const valid = stored.data.sessions.flatMap((item) => {
      const parsed = SessionSchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
    const grid = GridSchema.safeParse(stored.data.grid)
    return {
      sessions: Object.fromEntries(valid.map((session) => [session.tabId, session])),
      grid: grid.success ? grid.data : null
    }
  } catch {
    // Corrupt or unavailable storage starts with no records.
    return { sessions: {}, grid: null }
  }
}

function writePersisted(
  sessions: Readonly<Record<string, RemoteSession>>,
  grid: RemoteGrid | null
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessions: Object.values(sessions), grid })
    )
  } catch {
    // Storage can be unavailable; layouts just won't survive a restart.
  }
}

/** A tab with no record predates sessions, and those always ran a terminal. */
export function remoteSessionForTab(
  sessions: Readonly<Record<string, RemoteSession>>,
  tabId: string
): RemoteSession {
  return (
    sessions[tabId] ?? {
      tabId,
      targetId: '',
      layout: 'terminal',
      dockHeight: DEFAULT_REMOTE_DOCK_HEIGHT,
      terminalStarted: true
    }
  )
}

/** A tab in the grid shows what the grid shows, so panes on one screen never disagree. */
export function remoteLayoutForTab(
  sessions: Readonly<Record<string, RemoteSession>>,
  grid: RemoteGrid | null,
  tabId: string
): RemoteLayout {
  return grid?.tabIds.includes(tabId) ? grid.layout : remoteSessionForTab(sessions, tabId).layout
}

/** One height for a grid: clicking another pane must not resize the dock and refit every pane. */
export function remoteDockHeightForTab(
  sessions: Readonly<Record<string, RemoteSession>>,
  grid: RemoteGrid | null,
  tabId: string
): number {
  return grid?.tabIds.includes(tabId)
    ? grid.dockHeight
    : remoteSessionForTab(sessions, tabId).dockHeight
}

/** The tab to show for a host: the active one if it is on that host, else the first in the strip. */
export function findSessionTabOnHost(
  sessions: Readonly<Record<string, RemoteSession>>,
  orderedTabIds: readonly string[],
  activeTabId: string | null,
  targetId: string
): string | null {
  if (activeTabId && sessions[activeTabId]?.targetId === targetId) {
    return activeTabId
  }
  return orderedTabIds.find((tabId) => sessions[tabId]?.targetId === targetId) ?? null
}

export const useRemoteSessionStore = create<RemoteSessionState>((set, get) => {
  const updateSession = (tabId: string, patch: Partial<RemoteSession>): void => {
    const { sessions, grid } = get()
    const next = { ...sessions, [tabId]: { ...remoteSessionForTab(sessions, tabId), ...patch } }
    set({ sessions: next })
    writePersisted(next, grid)
  }
  const updateGrid = (grid: RemoteGrid | null): void => {
    set({ grid })
    writePersisted(get().sessions, grid)
  }
  /** A grid needs two panes; with fewer it is only a tab again. */
  const gridOf = (
    tabIds: readonly string[],
    current: Pick<RemoteGrid, 'layout' | 'dockHeight'>
  ): RemoteGrid | null => (tabIds.length >= 2 ? { ...current, tabIds } : null)
  const persisted = readPersisted()
  return {
    sessions: persisted.sessions,
    grid: persisted.grid,
    remotePathByTab: {},
    remoteSelectionByTab: {},
    addSession: (session) =>
      updateSession(session.tabId, { ...session, dockHeight: DEFAULT_REMOTE_DOCK_HEIGHT }),
    setLayout: (tabId, layout) => {
      const { grid } = get()
      if (grid?.tabIds.includes(tabId)) {
        updateGrid({ ...grid, layout })
      } else {
        updateSession(tabId, { layout })
      }
    },
    setDockHeight: (tabId, dockHeight) => {
      const { grid } = get()
      if (grid?.tabIds.includes(tabId)) {
        updateGrid({ ...grid, dockHeight })
      } else {
        updateSession(tabId, { dockHeight })
      }
    },
    markTerminalStarted: (tabId) => updateSession(tabId, { terminalStarted: true }),
    markTerminalStopped: (tabId) => updateSession(tabId, { terminalStarted: false }),
    setTargetId: (tabId, targetId) => updateSession(tabId, { targetId }),
    setRemotePath: (tabId, path) => {
      const { remotePathByTab } = get()
      if (remotePathByTab[tabId] !== path) {
        set({ remotePathByTab: { ...remotePathByTab, [tabId]: path } })
      }
    },
    setRemoteSelection: (tabId, paths) => {
      const { remoteSelectionByTab } = get()
      const current = remoteSelectionByTab[tabId] ?? []
      if (current.length !== paths.length || current.some((path, i) => path !== paths[i])) {
        set({ remoteSelectionByTab: { ...remoteSelectionByTab, [tabId]: paths } })
      }
    },
    addToGrid: (tabIds) => {
      const { grid } = get()
      const merged = [...new Set([...(grid?.tabIds ?? []), ...tabIds])]
      updateGrid(
        gridOf(
          merged.slice(0, MAX_REMOTE_GRID_TABS),
          grid ?? { layout: 'terminal', dockHeight: DEFAULT_REMOTE_DOCK_HEIGHT }
        )
      )
    },
    removeFromGrid: (tabId) => {
      const { grid } = get()
      if (grid) {
        updateGrid(
          gridOf(
            grid.tabIds.filter((id) => id !== tabId),
            grid
          )
        )
      }
    },
    clearGrid: () => updateGrid(null),
    prune: (openTabIds) => {
      const isOpen = ([tabId]: [string, unknown]): boolean => openTabIds.has(tabId)
      const { sessions, grid, remotePathByTab, remoteSelectionByTab } = get()
      const openGridTabs = grid?.tabIds.filter((tabId) => openTabIds.has(tabId)) ?? []
      const nextGrid =
        grid && openGridTabs.length !== grid.tabIds.length ? gridOf(openGridTabs, grid) : grid
      const openSessions = Object.entries(sessions).filter(isOpen)
      if (openSessions.length !== Object.keys(sessions).length || nextGrid !== grid) {
        const next = Object.fromEntries(openSessions)
        set({ sessions: next, grid: nextGrid })
        writePersisted(next, nextGrid)
      }
      const openPaths = Object.entries(remotePathByTab).filter(isOpen)
      if (openPaths.length !== Object.keys(remotePathByTab).length) {
        set({ remotePathByTab: Object.fromEntries(openPaths) })
      }
      const openSelections = Object.entries(remoteSelectionByTab).filter(isOpen)
      if (openSelections.length !== Object.keys(remoteSelectionByTab).length) {
        set({ remoteSelectionByTab: Object.fromEntries(openSelections) })
      }
    }
  }
})

const LegacySftpTabSchema = z.object({ id: z.string(), targetId: z.string(), label: z.string() })

const LegacySftpTabsSchema = z.object({
  tabs: z.array(z.unknown()),
  activeTabId: z.string().nullable().optional()
})

type LegacySftpTabs = { tabs: { targetId: string; label: string; wasActive: boolean }[] }

/** What the separate SFTP page saved; each tab becomes a files tab on its first run here. */
export function readLegacySftpTabs(): LegacySftpTabs {
  try {
    const raw = window.localStorage.getItem(LEGACY_SFTP_TABS_KEY)
    const stored = LegacySftpTabsSchema.safeParse(raw ? JSON.parse(raw) : null)
    if (!stored.success) {
      return { tabs: [] }
    }
    return {
      tabs: stored.data.tabs.flatMap((item) => {
        const tab = LegacySftpTabSchema.safeParse(item)
        return tab.success
          ? [
              {
                targetId: tab.data.targetId,
                label: tab.data.label,
                wasActive: tab.data.id === stored.data.activeTabId
              }
            ]
          : []
      })
    }
  } catch {
    return { tabs: [] }
  }
}

export function clearLegacySftpTabs(): void {
  try {
    window.localStorage.removeItem(LEGACY_SFTP_TABS_KEY)
  } catch {
    // Storage can be unavailable; there is nothing to convert then either.
  }
}
