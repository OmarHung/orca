import { translate } from '@/i18n/i18n'
import type { GitHistoryBranch, GitHistoryItem } from '../../../../../../shared/git-history'

const SHORT_SHA_LENGTH = 7

/** One side of a Git Log comparison: a commit or a branch tip, by full object id. */
export type GitLogCompareTarget = {
  oid: string
  label: string
}

export function commitCompareTarget(item: Pick<GitHistoryItem, 'id'>): GitLogCompareTarget {
  return { oid: item.id, label: item.id.slice(0, SHORT_SHA_LENGTH) }
}

export function branchCompareTarget(
  branch: Pick<GitHistoryBranch, 'revision' | 'name'>
): GitLogCompareTarget {
  return { oid: branch.revision, label: branch.name }
}

export function isSameCompareTarget(a: GitLogCompareTarget, b: GitLogCompareTarget): boolean {
  return a.oid.toLowerCase() === b.oid.toLowerCase()
}

/**
 * For two selected commits, the older one (further down the newest-first log)
 * is the base, so the diff reads as what happened between them.
 */
export function orderCommitPair(
  ids: readonly [string, string],
  logOrder: readonly string[]
): { base: string; target: string } {
  const [first, second] = ids
  return logOrder.indexOf(first) > logOrder.indexOf(second)
    ? { base: first, target: second }
    : { base: second, target: first }
}

export function compareTabLabel(base: GitLogCompareTarget, target: GitLogCompareTarget): string {
  return translate('bottomPanel.gitLog.compare.tabLabel', 'Compare {{base}} → {{target}}', {
    base: base.label,
    target: target.label
  })
}
