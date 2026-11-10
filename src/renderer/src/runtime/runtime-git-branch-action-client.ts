import type {
  GitBranchAction,
  GitBranchActionResult
} from '../../../shared/git-branch-action/git-branch-action-types'
import { REBASE_FROM_BASE_RPC_TIMEOUT_MS } from '../../../shared/git/remotes/git-rebase-source'
import {
  resolveLocalWorktreePath,
  type RuntimeGitContext
} from './source-control/git/runtime-git-client-context'
import { callRuntimeRpc } from './rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from './rpc/targets/runtime-worktree-selector'

export async function runRuntimeGitBranchAction(
  context: RuntimeGitContext,
  action: GitBranchAction
): Promise<GitBranchActionResult> {
  const target = context.target
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
