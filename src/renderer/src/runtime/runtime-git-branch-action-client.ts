import type {
  GitBranchAction,
  GitBranchActionResult
} from '../../../shared/git-branch-action/git-branch-action-types'
import { REBASE_FROM_BASE_RPC_TIMEOUT_MS } from '../../../shared/git-rebase-source'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-client-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

export async function runRuntimeGitBranchAction(
  context: RuntimeGitContext,
  action: GitBranchAction
): Promise<GitBranchActionResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.branchAction({
      worktreePath: resolveLocalWorktreePath(context),
      action,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitBranchActionResult>(
    target,
    'git.branchAction',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), action },
    { timeoutMs: REBASE_FROM_BASE_RPC_TIMEOUT_MS }
  )
}
