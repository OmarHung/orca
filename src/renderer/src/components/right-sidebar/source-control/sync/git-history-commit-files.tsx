import { createElement, useMemo, useState } from 'react'
import type React from 'react'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { STATUS_COLORS, STATUS_LABELS } from '../../status-display'
import {
  toPermanentSourceControlRowOpenEvent,
  toSourceControlRowOpenEvent,
  type SourceControlRowOpenEvent
} from '../listing/split-open'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { basename, dirname } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { formatGitHistoryTimestamp } from './git-history-format'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import type { GitFileStatus } from '../../../../../../shared/git-status-types'
import {
  buildSourceControlTree,
  compactSourceControlTree,
  flattenSourceControlTree
} from '../../source-control-tree'
import { SourceControlBranchTreeDirectoryRow } from '../listing/tree-directory-rows'
import {
  SOURCE_CONTROL_TREE_FILE_PADDING_PX,
  SOURCE_CONTROL_TREE_INDENT_PX
} from '../listing/row-layout'

// State for a single commit's lazily-loaded file list. Owned by GitHistoryPanel,
// populated through the onLoadCommitFiles loader supplied by SourceControl.
export type GitHistoryCommitFilesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; entries: GitBranchChangeEntry[] }

export type GitHistoryCommitFilesViewMode = 'list' | 'tree'

const LIST_ROW_PADDING_PX = 36

function CommitFileRow({
  entry,
  onOpen,
  paddingLeft = LIST_ROW_PADDING_PX,
  showDirectory = true
}: {
  entry: GitBranchChangeEntry
  onOpen: (entry: GitBranchChangeEntry, event: SourceControlRowOpenEvent) => void
  paddingLeft?: number
  /** Tree rows already show their folder, so the path hint would repeat it. */
  showDirectory?: boolean
}): React.JSX.Element {
  const status = entry.status as GitFileStatus
  const FileIcon = getFileTypeIcon(entry.path)
  const fileName = basename(entry.path)
  const parentDir = dirname(entry.path)
  const dirPath = parentDir === '.' ? '' : parentDir

  return (
    <button
      type="button"
      className="group flex w-full min-w-0 cursor-pointer items-center gap-1 py-1 pr-3 text-left text-xs transition-colors hover:bg-accent/40"
      style={{ paddingLeft }}
      title={entry.path}
      data-testid="git-history-commit-file"
      onClick={(event) => onOpen(entry, toSourceControlRowOpenEvent(event))}
      onDoubleClick={(event) => onOpen(entry, toPermanentSourceControlRowOpenEvent(event))}
    >
      {createElement(FileIcon, {
        className: 'size-3.5 shrink-0',
        style: { color: STATUS_COLORS[status] }
      })}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{fileName}</span>
        {showDirectory && dirPath && (
          <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>
        )}
      </span>
      <span
        className="w-4 shrink-0 text-center text-[10px] font-bold"
        style={{ color: STATUS_COLORS[status] }}
      >
        {STATUS_LABELS[status]}
      </span>
    </button>
  )
}

function CommitFilesTree({
  entries,
  onOpenFile
}: {
  entries: GitBranchChangeEntry[]
  onOpenFile: (entry: GitBranchChangeEntry, event: SourceControlRowOpenEvent) => void
}): React.JSX.Element {
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const roots = useMemo(
    () => compactSourceControlTree(buildSourceControlTree('branch', entries)),
    [entries]
  )
  const rows = useMemo(() => flattenSourceControlTree(roots, collapsedKeys), [roots, collapsedKeys])
  const toggle = (key: string): void => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  return (
    <>
      {rows.map((node) =>
        node.type === 'directory' ? (
          <SourceControlBranchTreeDirectoryRow
            key={node.key}
            node={node}
            isCollapsed={collapsedKeys.has(node.key)}
            onToggle={() => toggle(node.key)}
          />
        ) : (
          <CommitFileRow
            key={node.key}
            entry={node.entry}
            onOpen={onOpenFile}
            paddingLeft={
              node.depth * SOURCE_CONTROL_TREE_INDENT_PX + SOURCE_CONTROL_TREE_FILE_PADDING_PX
            }
            showDirectory={false}
          />
        )
      )}
    </>
  )
}

function CommitFilesBody({
  state,
  viewMode,
  onOpenFile,
  onOpenAll
}: {
  state: GitHistoryCommitFilesState
  viewMode: GitHistoryCommitFilesViewMode
  onOpenFile: (entry: GitBranchChangeEntry, event: SourceControlRowOpenEvent) => void
  onOpenAll?: () => void
}): React.JSX.Element {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-1 pl-9 pr-3 text-[11px] text-muted-foreground">
        <RefreshCw className="size-3 animate-spin" />
        <span>
          {translate(
            'auto.components.right.sidebar.GitHistoryCommitFiles.a1b2c3d4e5',
            'Loading files…'
          )}
        </span>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="py-1 pl-9 pr-3 text-[11px] text-destructive" title={state.error}>
        {state.error}
      </div>
    )
  }

  if (state.entries.length === 0) {
    return (
      <div className="py-1 pl-9 pr-3 text-[11px] text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.GitHistoryCommitFiles.b2c3d4e5f6',
          'No file changes in this commit'
        )}
      </div>
    )
  }

  return (
    <>
      {viewMode === 'tree' ? (
        <CommitFilesTree entries={state.entries} onOpenFile={onOpenFile} />
      ) : (
        state.entries.map((entry) => (
          <CommitFileRow key={entry.path} entry={entry} onOpen={onOpenFile} />
        ))
      )}
      {onOpenAll && (
        <button
          type="button"
          className="flex w-full items-center gap-1 py-1 pl-9 pr-3 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={onOpenAll}
        >
          <ArrowUpRight className="size-3 shrink-0" />
          <span>
            {translate(
              'auto.components.right.sidebar.GitHistoryCommitFiles.c3d4e5f6a7',
              'Open all changes together'
            )}
          </span>
        </button>
      )}
    </>
  )
}

export function GitHistoryCommitFiles({
  state,
  author,
  timestamp,
  viewMode = 'list',
  onOpenFile,
  onOpenAll
}: {
  state: GitHistoryCommitFilesState
  author?: string
  timestamp?: number
  viewMode?: GitHistoryCommitFilesViewMode
  onOpenFile: (entry: GitBranchChangeEntry, event: SourceControlRowOpenEvent) => void
  onOpenAll?: () => void
}): React.JSX.Element {
  // Author and date move off the dense commit row and surface here on expand.
  const meta = [author, formatGitHistoryTimestamp(timestamp)].filter(Boolean).join(' · ')
  return (
    <div className="border-l border-border/60 bg-muted/20">
      {meta && <div className="py-1 pl-9 pr-3 text-[11px] text-muted-foreground">{meta}</div>}
      <CommitFilesBody
        state={state}
        viewMode={viewMode}
        onOpenFile={onOpenFile}
        onOpenAll={onOpenAll}
      />
    </div>
  )
}
