import React, { useEffect, useRef, useState } from 'react'
import { List, ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GIT_LOG_MIN_FILES_HEIGHT, useBottomPanelLayout } from '../bottom-panel-layout-store'
import { ResizeHandle } from '../ResizeHandle'
import { useBottomPanelRegionResize } from '../use-bottom-panel-region-resize'

const FILES_HEADER_HEIGHT_PX = 24
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
  const viewMode = useBottomPanelLayout((s) => s.commitFilesViewMode)
  const setViewMode = useBottomPanelLayout((s) => s.setCommitFilesViewMode)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const messageResize = useBottomPanelRegionResize(
    'messageHeight',
    'y',
    -1,
    () => (rootRef.current?.clientHeight ?? 0) - FILES_HEADER_HEIGHT_PX - GIT_LOG_MIN_FILES_HEIGHT
  )
  const toggleLabel =
    viewMode === 'tree'
      ? translate('bottomPanel.gitLog.showFilesAsList', 'Show files as list')
      : translate('bottomPanel.gitLog.showFilesAsTree', 'Show files as tree')

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        {translate('bottomPanel.gitLog.selectCommit', 'Select a commit to see its changes')}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col"
      data-testid="git-log-commit-details"
    >
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1 text-[11px] text-muted-foreground">
        <span className="flex-1 truncate">
          {files.status === 'ready'
            ? translate('bottomPanel.gitLog.changedFiles', '{{value0}} changed files', {
                value0: files.entries.length
              })
            : translate('bottomPanel.gitLog.changedFilesPending', 'Changed files')}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={toggleLabel}
          aria-pressed={viewMode === 'tree'}
          title={toggleLabel}
          data-testid="git-log-files-view-toggle"
          onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
        >
          {viewMode === 'tree' ? <List /> : <ListTree />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek py-1">
        <GitHistoryCommitFiles
          state={files}
          viewMode={viewMode}
          onOpenFile={(entry, event) => onOpenFile(item, entry, event)}
          onOpenAll={() => onOpenAll(item)}
        />
      </div>
      <div
        className="relative shrink-0 border-t border-border"
        data-testid="git-log-commit-message"
        style={{
          height: messageResize.size,
          maxHeight: `calc(100% - ${FILES_HEADER_HEIGHT_PX + GIT_LOG_MIN_FILES_HEIGHT}px)`
        }}
      >
        <ResizeHandle
          edge="top"
          label={translate('bottomPanel.gitLog.resizeMessage', 'Resize commit message')}
          handleProps={messageResize.handleProps}
        />
        <div className="h-full overflow-y-auto scrollbar-sleek px-3 py-2">
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
    </div>
  )
}
