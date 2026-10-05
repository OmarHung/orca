import type {
  GitBranchAction,
  GitBranchActionResult
} from '../../shared/git-branch-action/git-branch-action-types'
import { requireRuntimeGitProvider, type RuntimeGitCommandHost } from './runtime-git-command-target'

export class RuntimeGitBranchActionCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  async runRuntimeGitBranchAction(
    worktreeSelector: string,
    action: GitBranchAction
  ): Promise<GitBranchActionResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    return requireRuntimeGitProvider(target).runBranchAction(target.worktree.path, action)
  }
}
