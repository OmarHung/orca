import { createContext, useContext } from 'react'
import type {
  GitBranchAction,
  GitBranchActionKind
} from '../../../../../../shared/git-branch-action/git-branch-action-types'

export type GitLogActions = {
  /** The action in flight; menus disable the rest until it settles. */
  runningKind: GitBranchActionKind | null
  /** Checked-out branch short name, or null on a detached HEAD. */
  currentBranchName: string | null
  run: (action: GitBranchAction) => void
}

// Keep the context component-free so Fast Refresh preserves its identity.
export const GitLogActionsContext = createContext<GitLogActions | null>(null)

/** Null outside the Git Log (or before its worktree resolves): menus then hide their actions. */
export function useGitLogActions(): GitLogActions | null {
  return useContext(GitLogActionsContext)
}
