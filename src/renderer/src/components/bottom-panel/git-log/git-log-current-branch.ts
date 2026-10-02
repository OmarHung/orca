import type { GitHistoryItem, GitHistoryResult } from '../../../../../shared/git-history'
import type { GitLogScope } from './git-log-scope'

/**
 * The logged commits the checked-out branch also contains, like JetBrains' "Highlight: Current
 * Branch". Null when the log is the current branch itself, where every row would match.
 */
export function collectGitLogCurrentBranchIds(
  result: GitHistoryResult,
  scope: GitLogScope
): ReadonlySet<string> | null {
  const tips = currentBranchTips(result, scope)
  return tips ? collectAncestorIds(result.items, tips) : null
}

function currentBranchTips(
  result: GitHistoryResult,
  scope: GitLogScope
): readonly string[] | undefined {
  const head = result.currentRef
  if (!head?.revision) {
    return undefined
  }
  // Why HEAD alone: the all-branches log includes HEAD, so its ancestry is the shared set.
  if (result.revisionScope === 'all') {
    return [head.revision]
  }
  if (result.revisionScope === 'ref' && scope.kind === 'ref' && scope.fullName !== head.id) {
    return result.headMergeBases
  }
  return undefined
}

// Why a walk over loaded rows suffices: the log is topo-ordered, so a loaded commit's
// descendants up to the tips are loaded too.
function collectAncestorIds(
  items: readonly GitHistoryItem[],
  tips: readonly string[]
): ReadonlySet<string> {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const reached = new Set<string>()
  const pending = tips.filter((id) => itemsById.has(id))
  while (pending.length > 0) {
    const id = pending.pop()!
    if (reached.has(id)) {
      continue
    }
    reached.add(id)
    for (const parentId of itemsById.get(id)?.parentIds ?? []) {
      if (itemsById.has(parentId) && !reached.has(parentId)) {
        pending.push(parentId)
      }
    }
  }
  return reached
}
