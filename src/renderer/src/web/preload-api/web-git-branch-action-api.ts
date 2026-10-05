import type { PreloadApi } from '../../../../preload/api-types'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { callRuntimeResult } from './web-runtime-calls'
import { resolveRuntimeWorktreeByPath } from './web-runtime-worktree-catalog'

type BranchActionApi = PreloadApi['git']['branchAction']

export const runWebGitBranchAction: BranchActionApi = async ({ worktreePath, action }) => {
  const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
  return callRuntimeResult('git.branchAction', {
    worktree: toRuntimeWorktreeSelector(worktree.id),
    action
  })
}
