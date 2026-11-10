import { useAppStore } from '@/store'
import { getIndexedRepoMap } from '@/store/repos/repository-catalog-index'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { getConnectionId } from '@/lib/connection-context'
import { runtimeTargetForWorkspaceOwner } from '@/lib/resolve-owner'
import type { RuntimeGitContext } from '@/runtime/source-control/git/runtime-git-client-context'
import { isGitRepoKind } from '../../../../../shared/repo-kind'

/** Git routing for a worktree's owning host, or null for folders and unknown worktrees. */
export function resolveRevisionCompareContext(worktreeId: string): RuntimeGitContext | null {
  const state = useAppStore.getState()
  const worktree = getIndexedWorktreeMap(selectWorktreesByRepo(state)).get(worktreeId)
  const repo = worktree ? getIndexedRepoMap(state.repos).get(worktree.repoId) : undefined
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
