import { useMemo } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { GitLogCompareContext } from './open-git-log-compare'

/** Stable git routing for Git Log compares; null while no workspace is shown. */
export function useGitLogCompareContext(worktree: {
  worktreeId: string | null
  worktreePath: string | null
  repoSettings: RuntimeGitContext['settings']
}): GitLogCompareContext | null {
  const { worktreeId, worktreePath, repoSettings } = worktree
  return useMemo(
    () =>
      worktreeId && worktreePath
        ? {
            settings: repoSettings,
            worktreeId,
            worktreePath,
            connectionId: getConnectionId(worktreeId) ?? undefined
          }
        : null,
    [repoSettings, worktreeId, worktreePath]
  )
}
