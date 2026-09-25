import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client'

export type GitLogWorktree = {
  worktreeId: string | null
  worktreePath: string | null
  isFolder: boolean
  /** Settings routed to the repo OWNER host, so reads work for SSH/WSL/remote repos. */
  repoSettings: RuntimeGitContext['settings']
  /** Last HEAD git status observed; a change means the log is stale. */
  observedHead: string | null
}

/** The slice of active-worktree state the Git Log needs — far lighter than the source-control context. */
export function useGitLogWorktree(): GitLogWorktree {
  const activeWorktree = useActiveWorktree()
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const repo = useRepoById(activeWorktree?.repoId ?? null)
  const settings = useAppStore((s) => s.settings)
  const observedHead = useAppStore((s) =>
    worktreeId ? (s.gitStatusHeadByWorktree?.[worktreeId] ?? null) : null
  )
  const repoId = repo?.id ?? null
  const repoConnectionId = repo?.connectionId ?? null
  const repoExecutionHostId = repo?.executionHostId ?? null
  const repoSettings = useMemo(
    () =>
      getRepoOwnerRoutedSettings(
        settings,
        repoId
          ? {
              id: repoId,
              connectionId: repoConnectionId,
              executionHostId: repoExecutionHostId
            }
          : null
      ),
    [repoConnectionId, repoExecutionHostId, repoId, settings]
  )

  return {
    worktreeId,
    worktreePath: activeWorktree?.path ?? null,
    isFolder: repo ? isFolderRepo(repo) : false,
    repoSettings,
    observedHead
  }
}
