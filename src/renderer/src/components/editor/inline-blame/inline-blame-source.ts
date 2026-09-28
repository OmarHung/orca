import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { translate } from '@/i18n/i18n'
import { getRuntimeGitBlame } from '@/runtime/runtime-git-blame-client'
import { getRuntimeGitCommitCompare } from '@/runtime/runtime-git-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { GitBlameResult } from '../../../../../shared/git-blame'

const MAX_CACHED_BLAMES = 24

// Why: remounts (tab switches, view-mode toggles) would otherwise re-run git blame for an unchanged HEAD.
const blameCache = new Map<string, Promise<GitBlameResult | null>>()

function resolveContext(worktreeId: string): RuntimeGitContext | null {
  const state = useAppStore.getState()
  const worktree = getWorktreeMapFromState(state).get(worktreeId)
  const repo = worktree ? getRepoMapFromState(state).get(worktree.repoId) : undefined
  if (!worktree || !repo || !isGitRepoKind(repo)) {
    return null
  }
  const connectionId = getConnectionId(worktreeId) ?? undefined
  if (connectionId && state.sshConnectionStates.get(connectionId)?.status !== 'connected') {
    return null
  }
  return {
    settings: getSettingsForWorktreeRuntimeOwner(state, worktreeId),
    worktreeId,
    worktreePath: worktree.path,
    connectionId
  }
}

/** Blame for a worktree file at the given HEAD, or null when it can't be had right now. */
export function loadInlineBlame(
  worktreeId: string,
  relativePath: string,
  headKey: string
): Promise<GitBlameResult | null> {
  const context = resolveContext(worktreeId)
  if (!context) {
    return Promise.resolve(null)
  }
  const key = `${worktreeId}\0${relativePath}\0${headKey}`
  const cached = blameCache.get(key)
  if (cached) {
    return cached
  }
  const pending = getRuntimeGitBlame(context, relativePath).catch((error: unknown) => {
    // Why: an older SSH relay has no git.blame; stay quiet and keep the editor plain.
    console.warn('[inline-blame] git blame failed', error)
    return null
  })
  blameCache.set(key, pending)
  if (blameCache.size > MAX_CACHED_BLAMES) {
    const oldest = blameCache.keys().next().value
    if (oldest !== undefined) {
      blameCache.delete(oldest)
    }
  }
  return pending
}

/** Opens a blamed commit's changes as a combined diff tab. */
export async function openInlineBlameCommit(
  worktreeId: string,
  sha: string,
  summary: string
): Promise<void> {
  const context = resolveContext(worktreeId)
  if (!context) {
    return
  }
  try {
    const result = await getRuntimeGitCommitCompare(context, sha)
    if (result.summary.status !== 'ready') {
      throw new Error(result.summary.errorMessage ?? 'Commit could not be loaded.')
    }
    useAppStore
      .getState()
      .openCommitAllDiffs(
        worktreeId,
        context.worktreePath,
        result.summary,
        result.entries,
        summary,
        summary
      )
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate('inlineBlame.openFailed', 'Could not open the commit.')
    )
  }
}
