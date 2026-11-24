import type { Repo } from '../../repository/repo-types'
import { splitWorktreeId } from '../../worktree/id'
import type { ClaudeManagedAccount } from '../managed-account-types'

/** `Repo.claudeAccountId` value that pins a project to System default (the user's own folder). */
export const CLAUDE_PROJECT_SYSTEM_DEFAULT = 'system'

/** A project's own Claude account: a saved account id, or null for System default. */
export type ClaudeProjectAccount = { accountId: string | null }

/** A launch's project; its own Claude account, when it pins one, replaces the Accounts selection. */
export type ClaudeLaunchProject = { repoId: string }

/** Folder workspaces and unscoped launches have no project and follow the Accounts selection. */
export function claudeLaunchProjectForWorktree(
  worktreeId: string | null | undefined
): ClaudeLaunchProject | undefined {
  const repoId = worktreeId ? splitWorktreeId(worktreeId)?.repoId : undefined
  return repoId ? { repoId } : undefined
}

/**
 * The account a project pins on this host, or null when it follows the Accounts selection.
 * Only host accounts count: WSL lanes keep their per-distro selection, and a removed account's
 * stale pin falls back to Accounts rather than launching in a folder that no longer exists.
 */
export function resolveClaudeProjectAccount(
  repo: Pick<Repo, 'claudeAccountId'> | null | undefined,
  accounts: readonly Pick<ClaudeManagedAccount, 'id' | 'managedAuthRuntime'>[]
): ClaudeProjectAccount | null {
  const pinned = repo?.claudeAccountId?.trim()
  if (!pinned) {
    return null
  }
  if (pinned === CLAUDE_PROJECT_SYSTEM_DEFAULT) {
    return { accountId: null }
  }
  const account = accounts.find((candidate) => candidate.id === pinned)
  return account && account.managedAuthRuntime !== 'wsl' ? { accountId: account.id } : null
}
