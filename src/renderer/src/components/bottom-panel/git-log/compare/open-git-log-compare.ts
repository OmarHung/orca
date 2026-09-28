import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getRuntimeGitCommitCompare } from '@/runtime/runtime-git-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { GitCommitCompareResult } from '../../../../../../shared/git-diff-compare-types'
import {
  compareTabLabel,
  isSameCompareTarget,
  type GitLogCompareTarget
} from './git-log-compare-target'

export type GitLogCompareContext = RuntimeGitContext & { worktreeId: string; worktreePath: string }

/** base..target file changes, refusing a host that silently fell back to the first parent. */
export async function loadGitLogCompare(
  context: GitLogCompareContext,
  base: GitLogCompareTarget,
  target: GitLogCompareTarget
): Promise<GitCommitCompareResult> {
  const result = await getRuntimeGitCommitCompare(context, target.oid, base.oid)
  if (result.summary.status !== 'ready') {
    throw new Error(result.summary.errorMessage ?? 'Compare failed.')
  }
  // Why: an older host ignores the base and diffs against the first parent instead.
  const parentOid = result.summary.parentOid
  if (!parentOid || !isSameCompareTarget(base, { oid: parentOid, label: '' })) {
    throw new Error(
      translate(
        'bottomPanel.gitLog.compare.hostTooOld',
        'Update Orca on this host to compare two revisions.'
      )
    )
  }
  return result
}

export function openGitLogCompareResult(
  context: GitLogCompareContext,
  base: GitLogCompareTarget,
  target: GitLogCompareTarget,
  result: GitCommitCompareResult
): void {
  const label = compareTabLabel(base, target)
  useAppStore
    .getState()
    .openCommitAllDiffs(
      context.worktreeId,
      context.worktreePath,
      result.summary,
      result.entries,
      label,
      '',
      { compareLabel: label }
    )
}

/** Opens base → target as a combined diff tab, the same view a single commit gets. */
export async function openGitLogCompare(
  context: GitLogCompareContext,
  base: GitLogCompareTarget,
  target: GitLogCompareTarget
): Promise<void> {
  if (isSameCompareTarget(base, target)) {
    toast.info(translate('bottomPanel.gitLog.compare.identical', 'Both sides are the same commit.'))
    return
  }
  try {
    openGitLogCompareResult(context, base, target, await loadGitLogCompare(context, base, target))
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate('bottomPanel.gitLog.compare.failed', 'Could not compare these revisions.')
    )
  }
}
