import { create } from 'zustand'
import type { GitLogCompareTarget } from './git-log-compare-target'

type GitLogCompareState = {
  /** The side picked with "Select for Compare", waiting for "Compare with …". */
  selected: GitLogCompareTarget | null
  select: (target: GitLogCompareTarget) => void
  clear: () => void
}

export const useGitLogCompareStore = create<GitLogCompareState>((set) => ({
  selected: null,
  select: (target) => set({ selected: target }),
  clear: () => set({ selected: null })
}))
