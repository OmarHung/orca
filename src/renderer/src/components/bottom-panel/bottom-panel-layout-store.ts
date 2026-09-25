import { create } from 'zustand'

export const BOTTOM_PANEL_MIN_HEIGHT = 140
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 300
/** Leave the workbench at least this much room above the panel. */
export const BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT = 160
const BOTTOM_PANEL_ABSOLUTE_MAX_HEIGHT = 2000

const STORAGE_KEY = 'orca.bottomPanel.layout.v1'

type PersistedBottomPanelLayout = {
  open: boolean
  height: number
}

type BottomPanelLayoutState = PersistedBottomPanelLayout & {
  setOpen: (open: boolean) => void
  toggle: () => void
  setHeight: (height: number) => void
}

export function clampBottomPanelHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return BOTTOM_PANEL_DEFAULT_HEIGHT
  }
  return Math.min(BOTTOM_PANEL_ABSOLUTE_MAX_HEIGHT, Math.max(BOTTOM_PANEL_MIN_HEIGHT, height))
}

function readPersistedLayout(): PersistedBottomPanelLayout {
  const fallback = { open: false, height: BOTTOM_PANEL_DEFAULT_HEIGHT }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return fallback
    }
    const open = 'open' in parsed && parsed.open === true
    const height =
      'height' in parsed && typeof parsed.height === 'number'
        ? clampBottomPanelHeight(parsed.height)
        : BOTTOM_PANEL_DEFAULT_HEIGHT
    return { open, height }
  } catch {
    return fallback
  }
}

function writePersistedLayout(layout: PersistedBottomPanelLayout): void {
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
    writePersistedLayout({ open, height: get().height })
  },
  toggle: () => get().setOpen(!get().open),
  setHeight: (height) => {
    const next = clampBottomPanelHeight(height)
    set({ height: next })
    writePersistedLayout({ open: get().open, height: next })
  }
}))
