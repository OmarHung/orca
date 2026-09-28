import { create } from 'zustand'

/** What an editor file is being compared with: a branch tip or a commit, by full object id. */
export type RevisionCompareBaseline = { oid: string; label: string }

export type RevisionComparePickerRequest = {
  mode: 'branch' | 'revision'
  fileId: string
  worktreeId: string
  relativePath: string
}

type RevisionCompareState = {
  baselineByFileId: Record<string, RevisionCompareBaseline>
  pickerRequest: RevisionComparePickerRequest | null
  openPicker: (request: RevisionComparePickerRequest) => void
  closePicker: () => void
  setBaseline: (fileId: string, baseline: RevisionCompareBaseline) => void
  clearBaseline: (fileId: string) => void
}

export const useRevisionCompareStore = create<RevisionCompareState>((set) => ({
  baselineByFileId: {},
  pickerRequest: null,
  openPicker: (request) => set({ pickerRequest: request }),
  closePicker: () => set({ pickerRequest: null }),
  setBaseline: (fileId, baseline) =>
    set((state) => ({ baselineByFileId: { ...state.baselineByFileId, [fileId]: baseline } })),
  clearBaseline: (fileId) =>
    set((state) => {
      if (!(fileId in state.baselineByFileId)) {
        return state
      }
      const { [fileId]: _cleared, ...rest } = state.baselineByFileId
      return { baselineByFileId: rest }
    })
}))
