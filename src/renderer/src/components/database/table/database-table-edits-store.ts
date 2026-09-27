import { create } from 'zustand'
import { NO_TABLE_EDITS, type TableEdits } from './table-edits'

export type TableEditState = {
  edits: TableEdits
  /** Display row whose change failed on the last submit; cleared by the next edit. */
  failedRow: number | null
  submitting: boolean
}

const IDLE: TableEditState = { edits: NO_TABLE_EDITS, failedRow: null, submitting: false }

type TableEditsStore = {
  tabs: Record<string, TableEditState>
  edit: (tabId: string, update: (edits: TableEdits) => TableEdits) => void
  setSubmitting: (tabId: string, submitting: boolean) => void
  setFailedRow: (tabId: string, row: number | null) => void
  /** Drops the tab's pending edits (after a submit or a discard). */
  reset: (tabId: string) => void
  dispose: (tabId: string) => void
}

export function getTableEditState(
  tabs: Record<string, TableEditState>,
  tabId: string
): TableEditState {
  return tabs[tabId] ?? IDLE
}

/** Pending table edits per tab, kept here because a tab's view unmounts when you switch away. */
export const useDatabaseTableEditsStore = create<TableEditsStore>((set) => {
  const patch = (tabId: string, update: (current: TableEditState) => Partial<TableEditState>) =>
    set((state) => {
      const current = getTableEditState(state.tabs, tabId)
      return { tabs: { ...state.tabs, [tabId]: { ...current, ...update(current) } } }
    })
  return {
    tabs: {},
    edit: (tabId, update) =>
      patch(tabId, (current) => ({ edits: update(current.edits), failedRow: null })),
    setSubmitting: (tabId, submitting) => patch(tabId, () => ({ submitting })),
    setFailedRow: (tabId, row) => patch(tabId, () => ({ failedRow: row })),
    reset: (tabId) => patch(tabId, () => ({ edits: NO_TABLE_EDITS, failedRow: null })),
    dispose: (tabId) =>
      set((state) => {
        const { [tabId]: _removed, ...rest } = state.tabs
        return { tabs: rest }
      })
  }
})
