import type { GitDiffResult } from '../../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../../shared/git-status-types'

// Why: useEditorPanelDiffContentLoader reports a failed read as an empty HEAD
// side plus this message, which would otherwise mark every line as added.
const DIFF_LOAD_ERROR_PREFIX = 'Error loading diff: '

/** The HEAD text the gutter compares against, or null when there is no usable one. */
export function getChangeMarkersBaseline(diff: GitDiffResult | undefined): string | null {
  if (!diff || diff.kind !== 'text' || diff.largeDiffRenderLimit?.limited === true) {
    return null
  }
  if (diff.originalContent === '' && diff.modifiedContent.startsWith(DIFF_LOAD_ERROR_PREFIX)) {
    return null
  }
  return diff.originalContent
}

/** An untracked file is all new; marking every line green says nothing. */
export function isChangeMarkersUntrackedPath(
  entries: readonly GitStatusEntry[] | null | undefined,
  relativePath: string
): boolean {
  return (entries ?? []).some(
    (entry) =>
      entry.path === relativePath && (entry.status === 'untracked' || entry.area === 'untracked')
  )
}
