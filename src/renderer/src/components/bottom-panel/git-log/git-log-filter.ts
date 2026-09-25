import type { GitHistoryItem } from '../../../../../shared/git-history'

export type GitLogFilter = {
  /** Matches subject, full message, or a hash prefix. */
  text: string
  author: string | null
}

export const EMPTY_GIT_LOG_FILTER: GitLogFilter = { text: '', author: null }

export function isGitLogFilterActive(filter: GitLogFilter): boolean {
  return filter.text.trim().length > 0 || filter.author !== null
}

export function filterGitLogItems(
  items: readonly GitHistoryItem[],
  filter: GitLogFilter
): readonly GitHistoryItem[] {
  if (!isGitLogFilterActive(filter)) {
    return items
  }
  const needle = filter.text.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (filter.author !== null && item.author !== filter.author) {
      return false
    }
    if (!needle) {
      return true
    }
    return (
      item.id.startsWith(needle) ||
      item.subject.toLocaleLowerCase().includes(needle) ||
      item.message.toLocaleLowerCase().includes(needle)
    )
  })
}

export function collectGitLogAuthors(items: readonly GitHistoryItem[]): string[] {
  const authors = new Set<string>()
  for (const item of items) {
    if (item.author) {
      authors.add(item.author)
    }
  }
  return [...authors].sort((a, b) => a.localeCompare(b))
}
