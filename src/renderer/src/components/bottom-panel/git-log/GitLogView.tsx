import React, { useCallback, useMemo, useRef, useState } from 'react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
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
import {
  canMarkGitLogCherryPicks,
  collectGitLogCherryPickedIds,
  collectGitLogCurrentBranchIds
} from './git-log-current-branch'
import { GitLogToolbar } from './GitLogToolbar'
import { useBottomPanelLayout } from '../bottom-panel-layout-store'
import { HEAD_GIT_LOG_SCOPE, isGitLogScopeHonored, type GitLogScope } from './git-log-scope'
import { useGitLogScope, useResetMissingGitLogScope } from './use-git-log-scope'
import { ResizeHandle } from '../ResizeHandle'
import { useGitLogColumnResize } from './use-git-log-column-resize'
import { useGitLogSelection } from './use-git-log-selection'
import {
  GitLogCommitCompareItems,
  type GitLogCompareHandler
} from './compare/GitLogCompareMenuItems'
import { openGitLogCompare } from './compare/open-git-log-compare'
import { useGitLogCompareContext } from './compare/use-git-log-compare-context'
import { GitLogRangeDetails } from './compare/GitLogRangeDetails'
import { GitLogActionsContext } from './actions/git-log-actions-context'
import { useGitLogBranchActions } from './actions/use-git-log-branch-actions'
import { GitLogActionDialogs } from './actions/GitLogActionDialogs'
import { GitLogCommitActionItems } from './actions/GitLogCommitActionItems'

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

export function GitLogView(): React.JSX.Element {
  const worktree = useGitLogWorktree()
  const { scope, setScope } = useGitLogScope(worktree.worktreeId)
  const markCherryPicks = useBottomPanelLayout((s) => s.markCherryPicks)
  const setMarkCherryPicks = useBottomPanelLayout((s) => s.setMarkCherryPicks)
  const { state, branchList, refresh } = useGitLogHistory(worktree, scope, true, markCherryPicks)
  useResetMissingGitLogScope(scope, branchList, setScope)
  const currentBranchName =
    (typeof branchList === 'object'
      ? branchList.branches.find((branch) => branch.isHead && branch.kind === 'local')?.name
      : state.result?.currentRef?.name) ?? null
  const reloadAfterAction = useCallback(() => void refresh({ silent: true }), [refresh])
  const branchActions = useGitLogBranchActions(worktree, currentBranchName, reloadAfterAction)
  const actionsAvailable = Boolean(
    worktree.worktreeId && worktree.worktreePath && !worktree.isFolder
  )
  const commitActions = useGitHistoryCommitActions({
    activeWorktreeId: worktree.worktreeId,
    worktreePath: worktree.worktreePath,
    activeRepoSettings: worktree.repoSettings,
    resolveSplitTargetGroupId: noSplitTarget
  })
  const [filter, setFilter] = useState<GitLogFilter>(EMPTY_GIT_LOG_FILTER)
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
  const currentBranchIds = useMemo(
    () => (result ? collectGitLogCurrentBranchIds(result, scope) : null),
    [result, scope]
  )
  const cherryPicksAvailable = canMarkGitLogCherryPicks(scope, result?.currentRef)
  const cherryPickedIds = useMemo(
    () => collectGitLogCherryPickedIds(result, markCherryPicks && cherryPicksAvailable),
    [cherryPicksAvailable, markCherryPicks, result]
  )
  const unpushedIds = useMemo(() => new Set(result?.unpushedIds ?? []), [result])
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
  const logOrder = useMemo(
    () => visibleViewModels.map((vm) => vm.historyItem.id),
    [visibleViewModels]
  )
  const selection = useGitLogSelection(logOrder)
  const selectedId = selection.selectedId
  const selectedItems = selection.orderedIds.flatMap(
    (id) => visibleViewModels.find((vm) => vm.historyItem.id === id)?.historyItem ?? []
  )
  const compareContext = useGitLogCompareContext(worktree)
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
      selection.selectOnly(nextId)
      listRef.current
        ?.querySelector(`[data-commit-id="${nextId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    },
    [selectedId, selection, visibleViewModels]
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

  const handleCompare: GitLogCompareHandler = (base, target) => {
    if (compareContext) {
      void openGitLogCompare(compareContext, base, target)
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
                    selected={selection.isSelected(item.id)}
                    inCurrentBranch={currentBranchIds?.has(item.id) ?? false}
                    cherryPicked={cherryPickedIds.has(item.id)}
                    unpushed={unpushedIds.has(item.id)}
                    showGraph={!filterActive}
                    gridTemplateColumns={gridTemplateColumns}
                    onSelectCommit={selection.handleClick}
                    onDoubleClick={() => void commitActions.openHistoryCommitDiff(item)}
                  />
                </ContextMenuTrigger>
                <GitHistoryCommitContextMenu
                  item={item}
                  onAction={commitActions.handleCommitAction}
                  extraItems={
                    <>
                      <GitLogCommitActionItems
                        item={item}
                        selectedIds={selection.orderedIds}
                        isOnCurrentBranch={(id) => currentBranchIds?.has(id) ?? true}
                      />
                      <GitLogCommitCompareItems
                        item={item}
                        selectedPair={selection.selectedPair}
                        logOrder={logOrder}
                        onCompare={handleCompare}
                      />
                    </>
                  }
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
    <GitLogActionsContext.Provider value={actionsAvailable ? branchActions : null}>
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
          <GitLogBranchTree
            branchList={branchList}
            scope={scope}
            onScopeChange={setScope}
            onCompare={handleCompare}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <GitLogToolbar
            filter={filter}
            onFilterChange={setFilter}
            authors={authors}
            scopeLabel={scopeLabel}
            cherryPicks={{
              available: cherryPicksAvailable,
              pressed: markCherryPicks,
              onPressedChange: setMarkCherryPicks
            }}
            loading={loading}
            onRefresh={() => void refresh()}
          />
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
              {selectedItems.length > 1 ? (
                <GitLogRangeDetails items={selectedItems} context={compareContext} />
              ) : (
                <GitLogCommitDetails
                  item={selectedItem}
                  loadCommitFiles={commitActions.loadCommitFiles}
                  onOpenFile={commitActions.openCommitFile}
                  onOpenAll={(item) => void commitActions.openHistoryCommitDiff(item)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <GitLogActionDialogs />
    </GitLogActionsContext.Provider>
  )
}
