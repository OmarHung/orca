import { create } from 'zustand'

export type RemoteSidePanelTab = 'hosts' | 'commands'

type RemoteHostsLayoutState = {
  isHostListCollapsed: boolean
  sidePanelTab: RemoteSidePanelTab
  toggleHostList: () => void
  setSidePanelTab: (tab: RemoteSidePanelTab) => void
}

type StoredLayout = Pick<RemoteHostsLayoutState, 'isHostListCollapsed' | 'sidePanelTab'>

// Why localStorage, not the app store: a per-viewer layout preference that keeps the fork's
// pages out of upstream's persisted UI state (same approach as the Database page).
const STORAGE_KEY = 'orca.remoteHostsLayout'

function readLayout(): StoredLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed === 'object' && parsed !== null) {
      const stored: Record<string, unknown> = { ...parsed }
      return {
        isHostListCollapsed: stored.ssh === true,
        sidePanelTab: stored.sidePanelTab === 'commands' ? 'commands' : 'hosts'
      }
    }
  } catch {
    // Corrupt or unavailable storage falls back to showing the list.
  }
  return { isHostListCollapsed: false, sidePanelTab: 'hosts' }
}

function writeLayout({ isHostListCollapsed, sidePanelTab }: StoredLayout): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ssh: isHostListCollapsed, sidePanelTab })
    )
  } catch {
    // Storage can be unavailable; the layout just won't survive a reload.
  }
}

export const useRemoteHostsLayout = create<RemoteHostsLayoutState>((set, get) => ({
  ...readLayout(),
  toggleHostList: () => {
    const next = { ...get(), isHostListCollapsed: !get().isHostListCollapsed }
    writeLayout(next)
    set({ isHostListCollapsed: next.isHostListCollapsed })
  },
  setSidePanelTab: (sidePanelTab) => {
    writeLayout({ ...get(), sidePanelTab })
    set({ sidePanelTab })
  }
}))
