import React, { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItem } from '../../../../../shared/git-history'
import type { GitBranchChangeEntry } from '../../../../../shared/git-diff-compare-types'
import {
  GitHistoryCommitFiles,
  type GitHistoryCommitFilesState
} from '../../right-sidebar/source-control/sync/git-history-commit-files'
import type { SourceControlRowOpenEvent } from '../../right-sidebar/source-control/listing/split-open'
import { formatGitLogFullDate } from './git-log-format'

type GitLogCommitDetailsProps = {
  item: GitHistoryItem | null
  loadCommitFiles: (item: GitHistoryItem) => Promise<GitBranchChangeEntry[]>
  onOpenFile: (
    item: GitHistoryItem,
    entry: GitBranchChangeEntry,
    event?: SourceControlRowOpenEvent
  ) => void
  onOpenAll: (item: GitHistoryItem) => void
}

function useCommitFiles(
  item: GitHistoryItem | null,
  loadCommitFiles: GitLogCommitDetailsProps['loadCommitFiles']
): GitHistoryCommitFilesState {
  const [state, setState] = useState<{
    id: string
    files: GitHistoryCommitFilesState
  } | null>(null)

  useEffect(() => {
    if (!item) {
      return
    }
    let cancelled = false
    setState({ id: item.id, files: { status: 'loading' } })
    loadCommitFiles(item).then(
      (entries) => {
        if (!cancelled) {
          setState({ id: item.id, files: { status: 'ready', entries } })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : translate('bottomPanel.gitLog.filesLoadFailed', 'Failed to load commit files')
          setState({ id: item.id, files: { status: 'error', error: message } })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [item, loadCommitFiles])

  // Why: until the effect for a newly selected commit runs, never show the previous commit's files.
  return state && item && state.id === item.id ? state.files : { status: 'loading' }
}

export function GitLogCommitDetails({
  item,
  loadCommitFiles,
  onOpenFile,
  onOpenAll
}: GitLogCommitDetailsProps): React.JSX.Element {
  const files = useCommitFiles(item, loadCommitFiles)

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        {translate('bottomPanel.gitLog.selectCommit', 'Select a commit to see its changes')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek py-1">
        <GitHistoryCommitFiles
          state={files}
          onOpenFile={(entry, event) => onOpenFile(item, entry, event)}
          onOpenAll={() => onOpenAll(item)}
        />
      </div>
      <div className="max-h-[50%] shrink-0 overflow-y-auto scrollbar-sleek border-t border-border px-3 py-2">
        <p className="whitespace-pre-wrap break-words font-mono text-xs text-foreground select-text">
          {item.message || item.subject}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground select-text">
          <span className="font-mono">{item.id}</span>
          {item.author ? (
            <>
              {' · '}
              {item.author}
              {item.authorEmail ? ` <${item.authorEmail}>` : ''}
            </>
          ) : null}
          {item.timestamp ? ` · ${formatGitLogFullDate(item.timestamp)}` : null}
        </p>
      </div>
    </div>
  )
}
