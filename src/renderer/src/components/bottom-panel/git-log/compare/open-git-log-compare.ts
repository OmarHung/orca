import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getRuntimeGitCommitCompare } from '@/runtime/runtime-git-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import {
  compareTabLabel,
  isSameCompareTarget,
  type GitLogCompareTarget
} from './git-log-compare-target'

export type GitLogCompareContext = RuntimeGitContext & { worktreeId: string; worktreePath: string }

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
    const result = await getRuntimeGitCommitCompare(context, target.oid, base.oid)
    if (result.summary.status !== 'ready') {
      throw new Error(result.summary.errorMessage ?? 'Compare failed.')
    }
    // Why: an older host ignores the base and diffs against the first parent instead.
    if (
      !result.summary.parentOid ||
      !isSameCompareTarget(base, { oid: result.summary.parentOid, label: '' })
    ) {
      throw new Error(
        translate(
          'bottomPanel.gitLog.compare.hostTooOld',
          'Update Orca on this host to compare two revisions.'
        )
      )
    }
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
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate('bottomPanel.gitLog.compare.failed', 'Could not compare these revisions.')
    )
  }
}
