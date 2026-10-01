import { create } from 'zustand'
import { useBottomPanelLayout } from '../bottom-panel/bottom-panel-layout-store'

type RunPanelState = {
  /** The run each workspace's Run panel shows, by command key. */
  selectedByWorktree: Record<string, string>
  /** The run terminal currently attached to the mounted Run panel. */
  shownTabId: string | null
  /** Focus is inside the Run panel, so its terminal takes keyboard shortcuts like a focused tab. */
  focused: boolean
  select: (worktreeId: string, commandKey: string) => void
  setShownTabId: (tabId: string | null) => void
  setFocused: (focused: boolean) => void
}

// Why not persisted: the panel falls back to the newest run, which is what a restart should show.
export const useRunPanelStore = create<RunPanelState>((set, get) => ({
  selectedByWorktree: {},
  shownTabId: null,
  focused: false,
  select: (worktreeId, commandKey) => {
    if (get().selectedByWorktree[worktreeId] !== commandKey) {
      set({ selectedByWorktree: { ...get().selectedByWorktree, [worktreeId]: commandKey } })
    }
  },
  setShownTabId: (shownTabId) => {
    if (get().shownTabId !== shownTabId) {
      set({ shownTabId })
    }
  },
  setFocused: (focused) => {
    if (get().focused !== focused) {
      set({ focused })
    }
  }
}))

/** Shows a run in the Run panel, opening the panel like JetBrains does when a run starts. */
export function revealRunInPanel(worktreeId: string, commandKey: string): void {
  useRunPanelStore.getState().select(worktreeId, commandKey)
  useBottomPanelLayout.getState().showTab('run')
}
