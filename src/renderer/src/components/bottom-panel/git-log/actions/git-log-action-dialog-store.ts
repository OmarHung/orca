import { create } from 'zustand'
import type { GitBranchActionResult } from '../../../../../../shared/git-branch-action/git-branch-action-types'

export type GitLogLocalChangesTarget = Extract<
  GitBranchActionResult,
  { status: 'local-changes' }
>['target']

/** The one Git Log action dialog open at a time; menus open it, GitLogActionDialogs renders it. */
export type GitLogActionDialogRequest =
  | { kind: 'createBranch'; startPoint: string; startLabel: string }
  | { kind: 'renameBranch'; ref: string; currentName: string }
  | { kind: 'createTag'; commit: string; commitLabel: string }
  | { kind: 'reset'; commit: string; commitLabel: string }
  | {
      kind: 'localChanges'
      target: GitLogLocalChangesTarget
      targetLabel: string
      files: readonly string[]
    }

type GitLogActionDialogState = {
  request: GitLogActionDialogRequest | null
  open: (request: GitLogActionDialogRequest) => void
  close: () => void
}

export const useGitLogActionDialogStore = create<GitLogActionDialogState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null })
}))
