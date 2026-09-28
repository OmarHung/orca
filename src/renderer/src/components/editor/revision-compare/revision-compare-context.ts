import { useAppStore } from '@/store'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
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
  return {
    settings: getSettingsForWorktreeRuntimeOwner(state, worktreeId),
    worktreeId,
    worktreePath: worktree.path,
    connectionId: getConnectionId(worktreeId) ?? undefined
  }
}
