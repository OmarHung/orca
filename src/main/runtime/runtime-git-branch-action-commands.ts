import type {
  GitBranchAction,
  GitBranchActionResult
} from '../../shared/git-branch-action/git-branch-action-types'
import { runLocalGitBranchAction } from '../git/git-branch-action'
import {
  localGitOptionsForTarget,
  requireRuntimeGitProvider,
  type RuntimeGitCommandHost
} from './runtime-git-command-target'

export class RuntimeGitBranchActionCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  async runRuntimeGitBranchAction(
    worktreeSelector: string,
    action: GitBranchAction
  ): Promise<GitBranchActionResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = requireRuntimeGitProvider(target)
    if (provider) {
      return provider.runBranchAction(target.worktree.path, action)
    }
    return runLocalGitBranchAction(target.worktree.path, action, localGitOptionsForTarget(target))
  }
}
