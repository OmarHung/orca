import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import type { SourceControlGroupOrder } from '../../../../shared/ui-chrome-types'
import { compareFileNames } from '../../../../shared/file-name-sort'
import { compareGitStatusEntries } from '../../../../shared/git-status-sort'
import {
  buildSourceControlDisplaySections,
  resolveSourceControlGroupOrder,
  type SourceControlEntryGroups,
  type SourceControlSectionArea
} from '../../../../shared/source-control-section-order'
import type { DiffChangeDirection } from './diff-change-step'

export type DiffFileSource = 'staged' | 'unstaged'

function sortedAreaEntries(
  entries: readonly GitStatusEntry[],
  area: SourceControlSectionArea
): GitStatusEntry[] {
  return entries.filter((entry) => entry.area === area).sort(compareGitStatusEntries)
}

// Why: the sequence follows the Source Control section order so next/previous file matches what the list shows.
export function buildDiffFileSequence(
  entries: readonly GitStatusEntry[],
  order: SourceControlGroupOrder | null | undefined
): GitStatusEntry[] {
  const groups: SourceControlEntryGroups = {
    unstaged: sortedAreaEntries(entries, 'unstaged'),
    staged: sortedAreaEntries(entries, 'staged'),
    untracked: sortedAreaEntries(entries, 'untracked')
  }
  return buildSourceControlDisplaySections(groups, resolveSourceControlGroupOrder(order))
    .flatMap((section) => section.items)
    .filter((entry) => !(entry.conflictKind && entry.conflictStatus))
}

// Why: branch and commit file lists have one entry per path, sorted like the Source Control branch section.
export function buildHistoryDiffFileSequence(
  entries: readonly GitBranchChangeEntry[]
): GitBranchChangeEntry[] {
  return [...entries].sort((a, b) => compareFileNames(a.path, b.path))
}

function adjacentAt<T>(
  sequence: readonly T[],
  index: number,
  direction: DiffChangeDirection
): T | null {
  if (index === -1) {
    return null
  }
  return sequence[direction === 'next' ? index + 1 : index - 1] ?? null
}

// Why: untracked files open as unstaged diffs, so only the staged flag decides which entry is current.
function matchesDiffSource(entry: GitStatusEntry, diffSource: DiffFileSource): boolean {
  return (entry.area === 'staged') === (diffSource === 'staged')
}

export function findAdjacentDiffEntry(
  sequence: readonly GitStatusEntry[],
  current: { relativePath: string; diffSource: DiffFileSource },
  direction: DiffChangeDirection
): GitStatusEntry | null {
  const index = sequence.findIndex(
    (entry) => entry.path === current.relativePath && matchesDiffSource(entry, current.diffSource)
  )
  return adjacentAt(sequence, index, direction)
}

export function findAdjacentHistoryDiffEntry(
  sequence: readonly GitBranchChangeEntry[],
  relativePath: string,
  direction: DiffChangeDirection
): GitBranchChangeEntry | null {
  return adjacentAt(
    sequence,
    sequence.findIndex((entry) => entry.path === relativePath),
    direction
  )
}
