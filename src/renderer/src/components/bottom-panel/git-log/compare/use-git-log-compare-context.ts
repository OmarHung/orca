import { useMemo } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import type { GitLogCompareContext } from './open-git-log-compare'

/** Stable git routing for Git Log compares; null while no workspace is shown. */
export function useGitLogCompareContext(worktree: {
  worktreeId: string | null
  worktreePath: string | null
  repoTarget: RuntimeClientTarget | null
}): GitLogCompareContext | null {
  const { worktreeId, worktreePath, repoTarget } = worktree
  return useMemo(
    () =>
      worktreeId && worktreePath && repoTarget
        ? {
            target: repoTarget,
            worktreeId,
            worktreePath,
            connectionId: getConnectionId(worktreeId) ?? undefined
          }
        : null,
    [repoTarget, worktreeId, worktreePath]
  )
}
