import { z } from 'zod'
import { create } from 'zustand'

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

type RemoteSessionState = {
  sessions: Readonly<Record<string, RemoteSession>>
  /** Remote folder each tab shows; not saved, since a tab reopens at the host's home. */
  remotePathByTab: Readonly<Record<string, string>>
  addSession: (session: NewRemoteSession) => void
  setLayout: (tabId: string, layout: RemoteLayout) => void
  setDockHeight: (tabId: string, dockHeight: number) => void
  markTerminalStarted: (tabId: string) => void
  /** The terminal ended but the tab stays for its files; connecting again starts a new one. */
  markTerminalStopped: (tabId: string) => void
  setTargetId: (tabId: string, targetId: string) => void
  setRemotePath: (tabId: string, path: string) => void
  /** Forgets every tab that is no longer open. */
  prune: (openTabIds: ReadonlySet<string>) => void
}

export const DEFAULT_REMOTE_DOCK_HEIGHT = 280

// Why localStorage: which layout a tab shows is a per-device choice, like column widths.
const STORAGE_KEY = 'orca.remoteSessions'
const LEGACY_SFTP_TABS_KEY = 'orca.sftpTabs'

const SessionSchema = z.object({
  tabId: z.string().min(1),
  targetId: z.string(),
  layout: z.enum(['terminal', 'split', 'files']),
  dockHeight: z.number().positive(),
  terminalStarted: z.boolean()
})

const StoredSessionsSchema = z.object({ sessions: z.array(z.unknown()) })

function readPersisted(): Record<string, RemoteSession> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const stored = StoredSessionsSchema.safeParse(raw ? JSON.parse(raw) : null)
    if (!stored.success) {
      return {}
    }
    const valid = stored.data.sessions.flatMap((item) => {
      const parsed = SessionSchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
    return Object.fromEntries(valid.map((session) => [session.tabId, session]))
  } catch {
    // Corrupt or unavailable storage starts with no records.
    return {}
  }
}

function writePersisted(sessions: Readonly<Record<string, RemoteSession>>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: Object.values(sessions) }))
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
    const { sessions } = get()
    const next = { ...sessions, [tabId]: { ...remoteSessionForTab(sessions, tabId), ...patch } }
    set({ sessions: next })
    writePersisted(next)
  }
  return {
    sessions: readPersisted(),
    remotePathByTab: {},
    addSession: (session) =>
      updateSession(session.tabId, { ...session, dockHeight: DEFAULT_REMOTE_DOCK_HEIGHT }),
    setLayout: (tabId, layout) => updateSession(tabId, { layout }),
    setDockHeight: (tabId, dockHeight) => updateSession(tabId, { dockHeight }),
    markTerminalStarted: (tabId) => updateSession(tabId, { terminalStarted: true }),
    markTerminalStopped: (tabId) => updateSession(tabId, { terminalStarted: false }),
    setTargetId: (tabId, targetId) => updateSession(tabId, { targetId }),
    setRemotePath: (tabId, path) => {
      const { remotePathByTab } = get()
      if (remotePathByTab[tabId] !== path) {
        set({ remotePathByTab: { ...remotePathByTab, [tabId]: path } })
      }
    },
    prune: (openTabIds) => {
      const isOpen = ([tabId]: [string, unknown]): boolean => openTabIds.has(tabId)
      const { sessions, remotePathByTab } = get()
      const openSessions = Object.entries(sessions).filter(isOpen)
      if (openSessions.length !== Object.keys(sessions).length) {
        const next = Object.fromEntries(openSessions)
        set({ sessions: next })
        writePersisted(next)
      }
      const openPaths = Object.entries(remotePathByTab).filter(isOpen)
      if (openPaths.length !== Object.keys(remotePathByTab).length) {
        set({ remotePathByTab: Object.fromEntries(openPaths) })
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
