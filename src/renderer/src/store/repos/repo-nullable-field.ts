import type { Repo } from '../../../../shared/repository/repo-types'

/** An optional repo field's update: `null` clears it, undefined leaves it untouched. */
export function applyNullableRepoField<K extends 'browserProfileId' | 'claudeAccountId'>(
  repo: Repo,
  field: K,
  value: Repo[K] | null | undefined
): Repo {
  if (value === undefined) {
    return repo
  }
  if (value === null) {
    const next = { ...repo }
    delete next[field]
    return next
  }
  return { ...repo, [field]: value }
}
