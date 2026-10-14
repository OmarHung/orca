import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type { AppState } from '@/store/types'
import {
  buildDiffFileSequence,
  buildHistoryDiffFileSequence,
  findAdjacentDiffEntry,
  findAdjacentHistoryDiffEntry
} from './diff-adjacent-file'
import type { DiffChangeDirection } from './diff-change-step'

type AdjacentOpener = () => void

function resolveWorkingTreeOpener(
  state: AppState,
  file: OpenFile,
  diffSource: 'staged' | 'unstaged',
  worktreePath: string,
  direction: DiffChangeDirection
): AdjacentOpener | null {
  const sequence = buildDiffFileSequence(
    state.gitStatusByWorktree[file.worktreeId] ?? [],
    state.settings?.sourceControlGroupOrder
  )
  const target = findAdjacentDiffEntry(
    sequence,
    { relativePath: file.relativePath, diffSource },
    direction
  )
  if (!target) {
    return null
  }
  return () =>
    state.openDiff(
      file.worktreeId,
      joinPath(worktreePath, target.path),
      target.path,
      detectLanguage(target.path),
      target.area === 'staged',
      { preview: true, runtimeEnvironmentId: file.runtimeEnvironmentId }
    )
}

function resolveHistoryOpener(
  state: AppState,
  file: OpenFile,
  worktreePath: string,
  direction: DiffChangeDirection
): AdjacentOpener | null {
  // Why: commit tabs carry their own file list; branch tabs fall back to the live branch compare.
  const entries =
    file.diffSource === 'commit'
      ? file.commitEntriesSnapshot
      : (file.branchEntriesSnapshot ?? state.gitBranchChangesByWorktree[file.worktreeId])
  if (!entries) {
    return null
  }
  const target = findAdjacentHistoryDiffEntry(
    buildHistoryDiffFileSequence(entries),
    file.relativePath,
    direction
  )
  if (!target) {
    return null
  }
  const options = {
    preview: true,
    runtimeEnvironmentId: file.runtimeEnvironmentId,
    entriesSnapshot: entries
  }
  const language = detectLanguage(target.path)
  const { commitCompare, branchCompare } = file
  if (file.diffSource === 'commit' && commitCompare) {
    return () =>
      state.openCommitDiff(file.worktreeId, worktreePath, target, commitCompare, language, options)
  }
  if (file.diffSource === 'branch' && branchCompare) {
    return () =>
      state.openBranchDiff(file.worktreeId, worktreePath, target, branchCompare, language, options)
  }
  return null
}

// Why: resolving before opening lets the caller tell "no neighbouring file" apart from "press again".
export function resolveAdjacentDiffOpener(
  file: OpenFile,
  direction: DiffChangeDirection
): AdjacentOpener | null {
  if (file.mode !== 'diff') {
    return null
  }
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, file.worktreeId)
  if (!worktree) {
    return null
  }
  if (file.diffSource === 'staged' || file.diffSource === 'unstaged') {
    return resolveWorkingTreeOpener(state, file, file.diffSource, worktree.path, direction)
  }
  if (file.diffSource === 'commit' || file.diffSource === 'branch') {
    return resolveHistoryOpener(state, file, worktree.path, direction)
  }
  return null
}
