import { getRelativePathInsideRoot, normalizeRelativePath } from '@/lib/path'

/** Relative to the workspace root, so a configuration works in every worktree of the repo. */
export function workspaceRelativePath(path: string, worktreePath: string): string {
  const relative = getRelativePathInsideRoot(path, worktreePath)
  return relative === null ? path : normalizeRelativePath(relative)
}
