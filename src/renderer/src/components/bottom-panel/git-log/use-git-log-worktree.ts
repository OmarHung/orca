import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/runtime-client-target'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

export type GitLogWorktree = {
  repoId: string | null
  worktreeId: string | null
  worktreePath: string | null
  isFolder: boolean
  /** Transport to the repo OWNER host, so reads work for SSH/WSL/remote repos; null without a repo row. */
  repoTarget: RuntimeClientTarget | null
  /** Last HEAD git status observed; a change means the log is stale. */
  observedHead: string | null
}

/** The slice of active-worktree state the Git Log needs — far lighter than the source-control context. */
export function useGitLogWorktree(): GitLogWorktree {
  const activeWorktree = useActiveWorktree()
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const repo = useRepoById(activeWorktree?.repoId ?? null)
  const observedHead = useAppStore((s) =>
    worktreeId ? (s.gitStatusHeadByWorktree?.[worktreeId] ?? null) : null
  )
  const repoId = repo?.id ?? null
  const repoConnectionId = repo?.connectionId ?? null
  const repoExecutionHostId = repo?.executionHostId ?? null
  const repoTarget = useMemo(
    () =>
      repoId
        ? ipcOrRuntimeTargetForHostId(
            getRepoExecutionHostId({
              connectionId: repoConnectionId,
              executionHostId: repoExecutionHostId
            })
          )
        : null,
    [repoConnectionId, repoExecutionHostId, repoId]
  )

  return {
    repoId,
    worktreeId,
    worktreePath: activeWorktree?.path ?? null,
    isFolder: repo ? isFolderRepo(repo) : false,
    repoTarget,
    observedHead
  }
}
