import type { GitHistoryItem } from '../../../../../../shared/git-history'
import { commitCompareTarget, type GitLogCompareTarget } from './git-log-compare-target'

export type GitLogRange = { base: GitLogCompareTarget; target: GitLogCompareTarget }

/**
 * The span several selected commits cover: from the oldest one's first parent
 * to the newest one, so the changes include the oldest commit's own. A root
 * commit has no parent to start from, so the range then starts at it.
 */
export function resolveGitLogRange(
  itemsNewestFirst: readonly GitHistoryItem[]
): GitLogRange | null {
  const newest = itemsNewestFirst[0]
  const oldest = itemsNewestFirst.at(-1)
  if (!newest || !oldest || newest.id === oldest.id) {
    return null
  }
  const parent = oldest.parentIds[0]
  return {
    base: parent ? commitCompareTarget({ id: parent }) : commitCompareTarget(oldest),
    target: commitCompareTarget(newest)
  }
}
