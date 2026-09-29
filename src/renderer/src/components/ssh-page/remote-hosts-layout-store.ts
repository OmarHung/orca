import { create } from 'zustand'

export type RemoteHostsPageId = 'ssh' | 'sftp'

type HostListCollapsed = Record<RemoteHostsPageId, boolean>

type RemoteHostsLayoutState = {
  hostListCollapsed: HostListCollapsed
  toggleHostList: (page: RemoteHostsPageId) => void
}

// Why localStorage, not the app store: a per-viewer layout preference that keeps the fork's
// pages out of upstream's persisted UI state (same approach as the Database page).
const STORAGE_KEY = 'orca.remoteHostsLayout'

function readHostListCollapsed(): HostListCollapsed {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed === 'object' && parsed !== null) {
      const stored: Record<string, unknown> = { ...parsed }
      return { ssh: stored.ssh === true, sftp: stored.sftp === true }
    }
  } catch {
    // Corrupt or unavailable storage falls back to showing the list.
  }
  return { ssh: false, sftp: false }
}

function writeHostListCollapsed(value: HostListCollapsed): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the layout just won't survive a reload.
  }
}

export const useRemoteHostsLayout = create<RemoteHostsLayoutState>((set, get) => ({
  hostListCollapsed: readHostListCollapsed(),
  toggleHostList: (page) => {
    const current = get().hostListCollapsed
    const next = { ...current, [page]: !current[page] }
    writeHostListCollapsed(next)
    set({ hostListCollapsed: next })
  }
}))
