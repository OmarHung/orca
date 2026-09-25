import React, { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronDown, GitBranch, RefreshCw, Search, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  buildDefaultGitHistoryColorMap,
  buildGitHistoryViewModels
} from '../../../../../shared/git-history-graph'
import { GitHistoryCommitContextMenu } from '../../right-sidebar/source-control/sync/git-history-commit-context-menu'
import { useGitHistoryCommitActions } from '../../right-sidebar/source-control/sync/use-git-history-commit-actions'
import { GitLogCommitDetails } from './git-log-commit-details'
import {
  EMPTY_GIT_LOG_FILTER,
  collectGitLogAuthors,
  filterGitLogItems,
  isGitLogFilterActive,
  type GitLogFilter
} from './git-log-filter'
import { GitLogTableRow } from './git-log-table-row'
import { GitLogTableHeader, useGitLogGridTemplate } from './git-log-table-columns'
import { useGitLogHistory } from './use-git-log-history'
import { useGitLogWorktree } from './use-git-log-worktree'
import { GitLogBranchTree } from './GitLogBranchTree'
import { HEAD_GIT_LOG_SCOPE, isGitLogScopeHonored, type GitLogScope } from './git-log-scope'
import { useGitLogScope, useResetMissingGitLogScope } from './use-git-log-scope'
import { ResizeHandle } from '../ResizeHandle'
import { useGitLogColumnResize } from './use-git-log-column-resize'

const ALL_AUTHORS_VALUE = '__all__'
const noSplitTarget = (): undefined => undefined

function describeGitLogScope(scope: GitLogScope, headName: string | undefined): string | undefined {
  if (scope.kind === 'all') {
    return translate('bottomPanel.gitLog.allScope', 'All Branches')
  }
  if (scope.kind === 'ref') {
    return scope.fullName.replace(/^refs\/(heads|remotes)\//, '')
  }
  return headName
}

function GitLogEmptyState({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
      {children}
    </div>
  )
}

function GitLogAuthorFilter({
  authors,
  value,
  onChange
}: {
  authors: readonly string[]
  value: string | null
  onChange: (author: string | null) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs">
          <User />
          <span className="max-w-[8rem] truncate">
            {value ?? translate('bottomPanel.gitLog.userFilter', 'User')}
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72">
        <DropdownMenuRadioGroup
          value={value ?? ALL_AUTHORS_VALUE}
          onValueChange={(next) => onChange(next === ALL_AUTHORS_VALUE ? null : next)}
        >
          <DropdownMenuRadioItem value={ALL_AUTHORS_VALUE}>
            {translate('bottomPanel.gitLog.allUsers', 'All users')}
          </DropdownMenuRadioItem>
          {authors.length > 0 ? <DropdownMenuSeparator /> : null}
          {authors.map((author) => (
            <DropdownMenuRadioItem key={author} value={author}>
              {author}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function GitLogView(): React.JSX.Element {
  const worktree = useGitLogWorktree()
  const { scope, setScope } = useGitLogScope(worktree.worktreeId)
  const { state, branchList, refresh } = useGitLogHistory(worktree, scope, true)
  useResetMissingGitLogScope(scope, branchList, setScope)
  const commitActions = useGitHistoryCommitActions({
    activeWorktreeId: worktree.worktreeId,
    worktreePath: worktree.worktreePath,
    activeRepoSettings: worktree.repoSettings,
    resolveSplitTargetGroupId: noSplitTarget
  })
  const [filter, setFilter] = useState<GitLogFilter>(EMPTY_GIT_LOG_FILTER)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const gridTemplateColumns = useGitLogGridTemplate()
  const { rootRef, branchTreeResize, detailsResize } = useGitLogColumnResize()

  const result = state.result
  const viewModels = useMemo(() => {
    if (!result) {
      return []
    }
    // Why no incoming/outgoing rows: the log lists real commits only, like JetBrains' Log tab.
    return buildGitHistoryViewModels(
      result.items,
      buildDefaultGitHistoryColorMap(result),
      result.currentRef,
      result.remoteRef,
      result.baseRef,
      false,
      false,
      result.mergeBase
    )
  }, [result])
  const authors = useMemo(() => collectGitLogAuthors(result?.items ?? []), [result])
  const filterActive = isGitLogFilterActive(filter)
  const visibleViewModels = useMemo(() => {
    if (!filterActive) {
      return viewModels
    }
    const matchingIds = new Set(
      filterGitLogItems(
        viewModels.map((vm) => vm.historyItem),
        filter
      ).map((item) => item.id)
    )
    return viewModels.filter((vm) => matchingIds.has(vm.historyItem.id))
  }, [filter, filterActive, viewModels])
  const selectedItem =
    visibleViewModels.find((vm) => vm.historyItem.id === selectedId)?.historyItem ?? null

  const moveSelection = useCallback(
    (delta: number): void => {
      if (visibleViewModels.length === 0) {
        return
      }
      const currentIndex = visibleViewModels.findIndex((vm) => vm.historyItem.id === selectedId)
      const nextIndex = Math.min(
        visibleViewModels.length - 1,
        Math.max(0, currentIndex === -1 ? 0 : currentIndex + delta)
      )
      const nextId = visibleViewModels[nextIndex]!.historyItem.id
      setSelectedId(nextId)
      listRef.current
        ?.querySelector(`[data-commit-id="${nextId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    },
    [selectedId, visibleViewModels]
  )

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' && selectedItem) {
      event.preventDefault()
      void commitActions.openHistoryCommitDiff(selectedItem)
    }
  }

  const loading = state.status === 'loading' || state.status === 'refreshing'
  const scopeHonored = !result || isGitLogScopeHonored(scope, result)
  // Why: an older host logged HEAD regardless, so label what is actually shown.
  const scopeLabel = describeGitLogScope(
    scopeHonored ? scope : HEAD_GIT_LOG_SCOPE,
    result?.currentRef?.name
  )

  const renderBody = (): React.ReactNode => {
    if (!worktree.worktreeId || !worktree.worktreePath) {
      return (
        <GitLogEmptyState>
          {translate('bottomPanel.gitLog.noWorkspace', 'Open a workspace to see its Git log')}
        </GitLogEmptyState>
      )
    }
    if (worktree.isFolder) {
      return (
        <GitLogEmptyState>
          {translate('bottomPanel.gitLog.folderWorkspace', 'This folder is not a Git repository')}
        </GitLogEmptyState>
      )
    }
    if (!result) {
      return state.status === 'error' ? (
        <GitLogEmptyState>
          <span className="text-destructive">{state.error}</span>
        </GitLogEmptyState>
      ) : (
        <GitLogEmptyState>
          {translate('bottomPanel.gitLog.loading', 'Loading commits…')}
        </GitLogEmptyState>
      )
    }
    if (visibleViewModels.length === 0) {
      return (
        <GitLogEmptyState>
          {filterActive
            ? translate('bottomPanel.gitLog.noMatches', 'No commits match the filter')
            : translate('bottomPanel.gitLog.noCommits', 'No commits yet')}
        </GitLogEmptyState>
      )
    }
    return (
      <div
        ref={listRef}
        tabIndex={0}
        aria-label={translate('bottomPanel.gitLog.commitList', 'Commits')}
        className="min-h-0 flex-1 overflow-auto scrollbar-sleek outline-none"
        data-testid="git-log-table"
        onKeyDown={handleListKeyDown}
      >
        {/* Why w-max: fixed-width columns may exceed the viewport; the table then scrolls sideways like Excel. */}
        <div className="w-max min-w-full">
          <GitLogTableHeader tableRef={listRef} gridTemplateColumns={gridTemplateColumns} />
          {visibleViewModels.map((viewModel) => {
            const item = viewModel.historyItem
            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <GitLogTableRow
                    data-commit-id={item.id}
                    viewModel={viewModel}
                    selected={item.id === selectedId}
                    showGraph={!filterActive}
                    gridTemplateColumns={gridTemplateColumns}
                    onSelectCommit={setSelectedId}
                    onDoubleClick={() => void commitActions.openHistoryCommitDiff(item)}
                  />
                </ContextMenuTrigger>
                <GitHistoryCommitContextMenu
                  item={item}
                  onAction={commitActions.handleCommitAction}
                />
              </ContextMenu>
            )
          })}
          {result.hasMore && !filterActive ? (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
              {translate('bottomPanel.gitLog.truncated', 'Showing the latest {{value0}} commits', {
                value0: result.items.length
              })}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <div
        className="relative shrink-0 border-r border-border"
        style={{ width: branchTreeResize.size, maxWidth: '40%' }}
      >
        <ResizeHandle
          edge="right"
          label={translate('bottomPanel.gitLog.resizeBranches', 'Resize branch tree')}
          handleProps={branchTreeResize.handleProps}
        />
        <GitLogBranchTree branchList={branchList} scope={scope} onScopeChange={setScope} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
          <div className="flex h-6 w-64 min-w-0 items-center gap-1.5 rounded-md border border-input px-2 focus-within:border-ring">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={filter.text}
              onChange={(event) => setFilter((prev) => ({ ...prev, text: event.target.value }))}
              placeholder={translate('bottomPanel.gitLog.searchPlaceholder', 'Text or hash')}
              aria-label={translate('bottomPanel.gitLog.searchPlaceholder', 'Text or hash')}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
            {filter.text ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label={translate('bottomPanel.gitLog.clearSearch', 'Clear search')}
                onClick={() => setFilter((prev) => ({ ...prev, text: '' }))}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
          <GitLogAuthorFilter
            authors={authors}
            value={filter.author}
            onChange={(author) => setFilter((prev) => ({ ...prev, author }))}
          />
          {scopeLabel ? (
            <span
              className="ml-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
              data-testid="git-log-scope-label"
            >
              <GitBranch className="size-3.5 shrink-0" />
              <span className="truncate">{scopeLabel}</span>
            </span>
          ) : null}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate('bottomPanel.gitLog.refresh', 'Refresh log')}
            title={translate('bottomPanel.gitLog.refresh', 'Refresh log')}
            onClick={() => void refresh()}
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {scopeHonored ? null : (
              <div className="shrink-0 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
                {translate(
                  'bottomPanel.gitLog.scopeUnsupported',
                  'This host runs an older Orca that can only show the current branch.'
                )}
              </div>
            )}
            {renderBody()}
          </div>
          <div
            className="relative shrink-0 border-l border-border"
            style={{ width: detailsResize.size, maxWidth: '60%' }}
          >
            <ResizeHandle
              edge="left"
              label={translate('bottomPanel.gitLog.resizeDetails', 'Resize commit details')}
              handleProps={detailsResize.handleProps}
            />
            <GitLogCommitDetails
              item={selectedItem}
              loadCommitFiles={commitActions.loadCommitFiles}
              onOpenFile={commitActions.openCommitFile}
              onOpenAll={(item) => void commitActions.openHistoryCommitDiff(item)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
