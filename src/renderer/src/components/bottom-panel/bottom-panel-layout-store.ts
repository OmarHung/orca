import { create } from 'zustand'
import type { GitHistoryCommitFilesViewMode } from '../right-sidebar/source-control/sync/git-history-commit-files'

/** Leave the workbench at least this much room above the panel. */
export const BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT = 160
/** The commit table's viewport keeps at least this width between the branch tree and details. */
export const GIT_LOG_MIN_TABLE_WIDTH = 280
/** The commit files list keeps at least this height above the message. */
export const GIT_LOG_MIN_FILES_HEIGHT = 60

export type BottomPanelSizeKey =
  | 'height'
  | 'branchTreeWidth'
  | 'detailsWidth'
  | 'messageHeight'
  | 'subjectColumnWidth'
  | 'authorColumnWidth'
  | 'dateColumnWidth'
  | 'hashColumnWidth'

/** Min, default, and a sanity max for values read back from storage. */
export const BOTTOM_PANEL_SIZE_LIMITS: Record<
  BottomPanelSizeKey,
  { min: number; fallback: number; max: number }
> = {
  height: { min: 140, fallback: 300, max: 2000 },
  branchTreeWidth: { min: 140, fallback: 224, max: 1200 },
  detailsWidth: { min: 220, fallback: 420, max: 2000 },
  messageHeight: { min: 48, fallback: 140, max: 1200 },
  subjectColumnWidth: { min: 80, fallback: 420, max: 3000 },
  authorColumnWidth: { min: 48, fallback: 128, max: 800 },
  dateColumnWidth: { min: 48, fallback: 144, max: 800 },
  hashColumnWidth: { min: 40, fallback: 88, max: 800 }
}

const STORAGE_KEY = 'orca.bottomPanel.layout.v1'

type BottomPanelSizes = Record<BottomPanelSizeKey, number>

export type BottomPanelTab = 'git-log' | 'debug'

type PersistedBottomPanelLayout = BottomPanelSizes & {
  open: boolean
  activeTab: BottomPanelTab
  commitFilesViewMode: GitHistoryCommitFilesViewMode
}

type BottomPanelLayoutState = PersistedBottomPanelLayout & {
  setOpen: (open: boolean) => void
  toggle: () => void
  /** Opens the panel on `tab`. */
  showTab: (tab: BottomPanelTab) => void
  /** Hides the panel if it is showing `tab`, otherwise shows `tab`. */
  toggleTab: (tab: BottomPanelTab) => void
  setSize: (key: BottomPanelSizeKey, size: number) => void
  /** Live size during a drag; not persisted until `setSize` on release. */
  previewSize: (key: BottomPanelSizeKey, size: number) => void
  setCommitFilesViewMode: (mode: GitHistoryCommitFilesViewMode) => void
}

export function clampBottomPanelSize(key: BottomPanelSizeKey, size: unknown): number {
  const { min, fallback, max } = BOTTOM_PANEL_SIZE_LIMITS[key]
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return fallback
  }
  return Math.min(max, Math.max(min, size))
}

function readPersistedLayout(): PersistedBottomPanelLayout {
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
  return {
    open: parsed.open === true,
    activeTab: parsed.activeTab === 'debug' ? 'debug' : 'git-log',
    commitFilesViewMode: parsed.commitFilesViewMode === 'tree' ? 'tree' : 'list',
    height: clampBottomPanelSize('height', parsed.height),
    branchTreeWidth: clampBottomPanelSize('branchTreeWidth', parsed.branchTreeWidth),
    detailsWidth: clampBottomPanelSize('detailsWidth', parsed.detailsWidth),
    messageHeight: clampBottomPanelSize('messageHeight', parsed.messageHeight),
    subjectColumnWidth: clampBottomPanelSize('subjectColumnWidth', parsed.subjectColumnWidth),
    authorColumnWidth: clampBottomPanelSize('authorColumnWidth', parsed.authorColumnWidth),
    dateColumnWidth: clampBottomPanelSize('dateColumnWidth', parsed.dateColumnWidth),
    hashColumnWidth: clampBottomPanelSize('hashColumnWidth', parsed.hashColumnWidth)
  }
}

function writePersistedLayout(state: PersistedBottomPanelLayout): void {
  const layout: PersistedBottomPanelLayout = {
    open: state.open,
    activeTab: state.activeTab,
    commitFilesViewMode: state.commitFilesViewMode,
    height: state.height,
    branchTreeWidth: state.branchTreeWidth,
    detailsWidth: state.detailsWidth,
    messageHeight: state.messageHeight,
    subjectColumnWidth: state.subjectColumnWidth,
    authorColumnWidth: state.authorColumnWidth,
    dateColumnWidth: state.dateColumnWidth,
    hashColumnWidth: state.hashColumnWidth
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Storage can be unavailable (private mode, quota); the layout just won't survive a reload.
  }
}

// Why localStorage, not PersistedUIState: panel size is a per-window-device preference,
// and the shared UI state is synced across paired desktop/web/mobile clients.
export const useBottomPanelLayout = create<BottomPanelLayoutState>((set, get) => ({
  ...readPersistedLayout(),
  setOpen: (open) => {
    set({ open })
    writePersistedLayout(get())
  },
  toggle: () => get().setOpen(!get().open),
  showTab: (activeTab) => {
    set({ open: true, activeTab })
    writePersistedLayout(get())
  },
  toggleTab: (tab) => {
    const { open, activeTab } = get()
    if (open && activeTab === tab) {
      get().setOpen(false)
      return
    }
    get().showTab(tab)
  },
  setSize: (key, size) => {
    set({ [key]: clampBottomPanelSize(key, size) })
    writePersistedLayout(get())
  },
  previewSize: (key, size) => {
    set({ [key]: clampBottomPanelSize(key, size) })
  },
  setCommitFilesViewMode: (commitFilesViewMode) => {
    set({ commitFilesViewMode })
    writePersistedLayout(get())
  }
}))
