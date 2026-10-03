import { create } from 'zustand'
import type { ForkUpdateChangelog } from '../../../../shared/fork-update-changelog'

type ForkUpdateChangelogState = {
  /** Null outside fork builds and before the first update. */
  changelog: ForkUpdateChangelog | null
  isOpen: boolean
  setChangelog: (changelog: ForkUpdateChangelog | null) => void
  openDialog: () => void
  closeDialog: () => void
}

export const useForkUpdateChangelogStore = create<ForkUpdateChangelogState>((set) => ({
  changelog: null,
  isOpen: false,
  setChangelog: (changelog) => set({ changelog }),
  openDialog: () => set({ isOpen: true }),
  closeDialog: () => set({ isOpen: false })
}))

/** The fork changelog bridge; absent in the web client and other non-desktop renderers. */
export function getForkUpdateChangelogApi(): Window['api']['forkUpdateChangelog'] | null {
  return 'forkUpdateChangelog' in window.api ? window.api.forkUpdateChangelog : null
}
