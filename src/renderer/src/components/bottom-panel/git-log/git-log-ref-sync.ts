import type { GitHistoryItemRef } from '../../../../../shared/git-history'
import { splitRemoteBranchName } from '../../../../../shared/git-effective-upstream'

/**
 * Local branch ref id → the remote-tracking ref that sits on the same commit and was folded into
 * its badge. Without this the one badge can't tell "pushed and in sync" from "never pushed".
 */
export function collectFoldedRemoteRefs(
  allRefs: readonly GitHistoryItemRef[],
  shownRefs: readonly GitHistoryItemRef[]
): ReadonlyMap<string, string> {
  const shownIds = new Set(shownRefs.map((ref) => ref.id))
  const folded = allRefs.filter(
    (ref) => ref.category === 'remote branches' && !shownIds.has(ref.id)
  )
  const result = new Map<string, string>()
  for (const local of shownRefs) {
    if (local.category !== 'branches') {
      continue
    }
    const remote = folded.find((ref) => splitRemoteBranchName(ref.name)?.branchName === local.name)
    if (remote) {
      result.set(local.id, remote.name)
    }
  }
  return result
}
