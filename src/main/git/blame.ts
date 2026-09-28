import type { GitBlameResult } from '../../shared/git-blame'
import { loadGitBlameFromExecutor } from '../../shared/git-blame'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

export async function getBlame(
  worktreePath: string,
  relativePath: string,
  options: GitRuntimeOptions = {}
): Promise<GitBlameResult> {
  return loadGitBlameFromExecutor(
    (args, cwd, execOptions) =>
      gitExecFileAsync(args, { ...gitOptionsForWorktree(cwd, options), ...execOptions }),
    worktreePath,
    relativePath
  )
}
