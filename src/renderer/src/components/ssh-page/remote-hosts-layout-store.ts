import { create } from 'zustand'

type RemoteHostsLayoutState = {
  isHostListCollapsed: boolean
  toggleHostList: () => void
}

// Why localStorage, not the app store: a per-viewer layout preference that keeps the fork's
// pages out of upstream's persisted UI state (same approach as the Database page).
const STORAGE_KEY = 'orca.remoteHostsLayout'

function readHostListCollapsed(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed === 'object' && parsed !== null) {
      const stored: Record<string, unknown> = { ...parsed }
      return stored.ssh === true
    }
  } catch {
    // Corrupt or unavailable storage falls back to showing the list.
  }
  return false
}

function writeHostListCollapsed(isCollapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ssh: isCollapsed }))
  } catch {
    // Storage can be unavailable; the layout just won't survive a reload.
  }
}

export const useRemoteHostsLayout = create<RemoteHostsLayoutState>((set, get) => ({
  isHostListCollapsed: readHostListCollapsed(),
  toggleHostList: () => {
    const next = !get().isHostListCollapsed
    writeHostListCollapsed(next)
    set({ isHostListCollapsed: next })
  }
}))
