/** `safe` lets git refuse over local changes; `smart` stashes and re-applies them; `force` drops them. */
export type GitCheckoutMode = 'safe' | 'smart' | 'force'

export type GitResetMode = 'soft' | 'mixed' | 'hard' | 'keep'

export type GitPullStrategy = 'merge' | 'rebase'

/** An operation git can leave stopped on conflicts, and abort again. */
export type GitAbortableOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

/**
 * A JetBrains-style branch or commit operation from the Git Log. Refs are full names under
 * `refs/heads/` or `refs/remotes/`; commits are object ids. The host validates every field again.
 */
export type GitBranchAction =
  | { kind: 'fetch' }
  | { kind: 'checkout'; ref: string; mode: GitCheckoutMode }
  | { kind: 'checkoutRevision'; commit: string; mode: GitCheckoutMode }
  | { kind: 'createBranch'; name: string; startPoint: string; checkout: boolean }
  | { kind: 'renameBranch'; ref: string; newName: string }
  | { kind: 'deleteBranch'; ref: string; force: boolean }
  | { kind: 'merge'; ref: string }
  | { kind: 'rebase'; ref: string }
  | { kind: 'checkoutAndRebase'; ref: string }
  | { kind: 'pull'; ref: string; strategy: GitPullStrategy }
  | { kind: 'push'; ref: string }
  | { kind: 'cherryPick'; commits: string[] }
  | { kind: 'revert'; commits: string[] }
  | { kind: 'reset'; commit: string; mode: GitResetMode }
  | { kind: 'createTag'; name: string; commit: string; message?: string }
  | { kind: 'abortOperation'; operation: GitAbortableOperation }

export type GitBranchActionKind = GitBranchAction['kind']

/** `stash` = re-applying stashed changes after a smart checkout hit conflicts. */
export type GitBranchActionConflictOperation = GitAbortableOperation | 'stash'

/** Expected outcomes the UI follows up on; anything else is thrown as an error. */
export type GitBranchActionResult =
  | { status: 'ok' }
  | {
      status: 'local-changes'
      /** What to retry with `smart` or `force`: a branch ref or a commit id. */
      target: { kind: 'ref'; ref: string } | { kind: 'commit'; commit: string }
      files: string[]
    }
  | { status: 'checked-out-elsewhere'; branch: string; worktreePath: string }
  | { status: 'not-fully-merged'; branch: string }
  | { status: 'conflicts'; operation: GitBranchActionConflictOperation }

/** Runs one git command; rejects on a non-zero exit with git's stderr on the error. */
export type GitBranchActionExecutor = (args: string[]) => Promise<{ stdout: string }>
