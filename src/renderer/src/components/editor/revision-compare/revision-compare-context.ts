import { useAppStore } from '@/store'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { getConnectionId } from '@/lib/connection-context'
import { runtimeTargetForWorkspaceOwner } from '@/lib/resolve-owner'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { isGitRepoKind } from '../../../../../shared/repo-kind'

/** Git routing for a worktree's owning host, or null for folders and unknown worktrees. */
export function resolveRevisionCompareContext(worktreeId: string): RuntimeGitContext | null {
  const state = useAppStore.getState()
  const worktree = getWorktreeMapFromState(state).get(worktreeId)
  const repo = worktree ? getRepoMapFromState(state).get(worktree.repoId) : undefined
  if (!worktree || !repo || !isGitRepoKind(repo)) {
    return null
  }
  const target = runtimeTargetForWorkspaceOwner(state, { workspaceId: worktreeId })
  if (!target) {
    return null
  }
  return {
    target,
    worktreeId,
    worktreePath: worktree.path,
    connectionId: getConnectionId(worktreeId) ?? undefined
  }
}
