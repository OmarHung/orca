import type { GitBlameResult } from '../../../shared/git-blame'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-client-context'
import { getActiveRuntimeTarget } from './runtime-rpc-client'

/**
 * Blame for one worktree file on its owning host (local, WSL or SSH). Returns
 * null for a remote Orca runtime, which has no blame RPC yet.
 */
export async function getRuntimeGitBlame(
  context: RuntimeGitContext,
  filePath: string
): Promise<GitBlameResult | null> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'local' && context.worktreeId) {
    return null
  }
  return window.api.git.blame({
    worktreePath: resolveLocalWorktreePath(context),
    filePath,
    connectionId: context.connectionId
  })
}
