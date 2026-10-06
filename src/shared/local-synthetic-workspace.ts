import { FLOATING_TERMINAL_WORKTREE_ID } from './constants'

/** Workspace that owns the SSH page's session tabs (fork-only). */
export const SSH_SESSIONS_WORKTREE_ID = 'global-ssh-sessions'

/** Workspace that owns the browser embedded in the monday page (fork-only). */
export const MONDAY_BROWSER_WORKTREE_ID = 'global-monday-browser'

const LOCAL_SYNTHETIC_WORKSPACE_IDS: readonly string[] = [
  FLOATING_TERMINAL_WORKTREE_ID,
  SSH_SESSIONS_WORKTREE_ID,
  MONDAY_BROWSER_WORKTREE_ID
]

/**
 * Workspaces with no repo or folder behind them. Their terminals always run on this machine,
 * and repo/folder scans never return them, so session hydration must keep them explicitly.
 */
export function isLocalSyntheticWorkspaceId(worktreeId: string | null | undefined): boolean {
  return worktreeId != null && LOCAL_SYNTHETIC_WORKSPACE_IDS.includes(worktreeId)
}

export function addLocalSyntheticWorkspaceIds(validWorktreeIds: Set<string>): void {
  for (const worktreeId of LOCAL_SYNTHETIC_WORKSPACE_IDS) {
    validWorktreeIds.add(worktreeId)
  }
}
