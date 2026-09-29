import { isLocalSyntheticWorkspaceId } from '../../../../shared/local-synthetic-workspace'

/** Synthetic workspaces are local-only and never belong to a host mirror. */
export function isHostMirroredWorktree(worktreeId: string): boolean {
  return !isLocalSyntheticWorkspaceId(worktreeId)
}
