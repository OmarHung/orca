import React, { useEffect, useMemo, useState } from 'react'
import { List, ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { useAppStore } from '@/store'
import type { GitHistoryItem } from '../../../../../../shared/git-history'
import type {
  GitBranchChangeEntry,
  GitCommitCompareResult
} from '../../../../../../shared/git-diff-compare-types'
import {
  GitHistoryCommitFiles,
  type GitHistoryCommitFilesState
} from '../../../right-sidebar/source-control/sync/git-history-commit-files'
import { useBottomPanelLayout } from '../../bottom-panel-layout-store'
import { compareTabLabel } from './git-log-compare-target'
import { resolveGitLogRange, type GitLogRange } from './git-log-range'
import {
  loadGitLogCompare,
  openGitLogCompareResult,
  type GitLogCompareContext
} from './open-git-log-compare'

type RangeState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; result: GitCommitCompareResult }
  | { key: string; status: 'error'; error: string }

function rangeKey(range: GitLogRange): string {
  return `${range.base.oid}..${range.target.oid}`
}

function useRangeCompare(
  context: GitLogCompareContext | null,
  range: GitLogRange | null
): RangeState | null {
  const [state, setState] = useState<RangeState | null>(null)
  const key = range ? rangeKey(range) : null
  useEffect(() => {
    if (!context || !range || !key) {
      return
    }
    let cancelled = false
    setState({ key, status: 'loading' })
    loadGitLogCompare(context, range.base, range.target).then(
      (result) => !cancelled && setState({ key, status: 'ready', result }),
      (error: unknown) =>
        !cancelled &&
        setState({
          key,
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : translate('bottomPanel.gitLog.compare.failed', 'Could not compare these revisions.')
        })
    )
    return () => {
      cancelled = true
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Why: `key` stands in for `range`, which is rebuilt each render.
  }, [context, key])
  return state && state.key === key ? state : null
}

/** Details for several selected commits: the files changed across the span they cover. */
export function GitLogRangeDetails({
  items,
  context
}: {
  items: readonly GitHistoryItem[]
  context: GitLogCompareContext | null
}): React.JSX.Element | null {
  const range = useMemo(() => resolveGitLogRange(items), [items])
  const state = useRangeCompare(context, range)
  const viewMode = useBottomPanelLayout((s) => s.commitFilesViewMode)
  const setViewMode = useBottomPanelLayout((s) => s.setCommitFilesViewMode)
  if (!range || !context) {
    return null
  }
  const files: GitHistoryCommitFilesState =
    state?.status === 'ready'
      ? { status: 'ready', entries: state.result.entries }
      : state?.status === 'error'
        ? { status: 'error', error: state.error }
        : { status: 'loading' }
  const label = compareTabLabel(range.base, range.target)
  const openFile = (entry: GitBranchChangeEntry): void => {
    useAppStore.getState().openCommitDiff(
      context.worktreeId,
      context.worktreePath,
      entry,
      {
        commitOid: range.target.oid,
        parentOid: range.base.oid,
        compareRef: `${range.base.label}..${range.target.label}`,
        baseRef: range.base.label,
        subject: label
      },
      detectLanguage(entry.path)
    )
  }
  const toggleLabel =
    viewMode === 'tree'
      ? translate('bottomPanel.gitLog.showFilesAsList', 'Show files as list')
      : translate('bottomPanel.gitLog.showFilesAsTree', 'Show files as tree')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="git-log-range-details">
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1 text-[11px] text-muted-foreground">
        <span className="flex-1 truncate">
          {files.status === 'ready'
            ? translate(
                'bottomPanel.gitLog.range.summary',
                '{{commits}} commits · {{files}} changed files',
                { commits: items.length, files: files.entries.length }
              )
            : translate('bottomPanel.gitLog.range.pending', '{{commits}} commits', {
                commits: items.length
              })}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={toggleLabel}
          aria-pressed={viewMode === 'tree'}
          title={toggleLabel}
          onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
        >
          {viewMode === 'tree' ? <List /> : <ListTree />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek py-1">
        <GitHistoryCommitFiles
          state={files}
          viewMode={viewMode}
          onOpenFile={openFile}
          onOpenAll={() => {
            if (state?.status === 'ready') {
              openGitLogCompareResult(context, range.base, range.target, state.result)
            }
          }}
        />
      </div>
      <div className="max-h-[40%] shrink-0 overflow-y-auto scrollbar-sleek border-t border-border px-3 py-2 text-xs">
        <p className="mb-1 text-[11px] text-muted-foreground select-text">
          {translate('bottomPanel.gitLog.range.span', 'Changes from {{base}} to {{target}}', {
            base: range.base.label,
            target: range.target.label
          })}
        </p>
        {items.map((item) => (
          <p key={item.id} className="truncate select-text">
            <span className="font-mono text-muted-foreground">{item.id.slice(0, 7)}</span>{' '}
            {item.subject}
          </p>
        ))}
      </div>
    </div>
  )
}
