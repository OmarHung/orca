import type { Repo } from '../../../shared/repository/repo-types'

/** Optional repo fields whose `null` update clears them. */
type NullClearedRepoField = 'browserProfileId' | 'claudeAccountId'

/** Drop each `null`-cleared field from the stored row and from the patch applied to it. */
export function clearNullRepoFields(
  repo: Repo,
  updates: Partial<Record<NullClearedRepoField, string | null>>,
  fields: readonly NullClearedRepoField[]
): void {
  for (const field of fields) {
    if (field in updates && updates[field] == null) {
      delete repo[field]
      delete updates[field]
    }
  }
}
