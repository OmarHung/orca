import React, { useMemo, useState } from 'react'
import { ChevronDown, Folder, GitBranch, Layers, Search, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  buildGitLogBranchTree,
  flattenGitLogBranchTree,
  type GitLogBranchTreeNode
} from './git-log-branch-tree'
import { ALL_GIT_LOG_SCOPE, HEAD_GIT_LOG_SCOPE, type GitLogScope } from './git-log-scope'
import type { GitLogBranchListState } from './use-git-log-history'
import type { GitHistoryBranch } from '../../../../../shared/git-history'

const NO_BRANCHES: readonly GitHistoryBranch[] = []
const INDENT_PX = 12
const BASE_PADDING_PX = 8

type GitLogBranchTreeProps = {
  branchList: GitLogBranchListState
  scope: GitLogScope
  onScopeChange: (scope: GitLogScope) => void
}

function TreeRow({
  depth,
  selected,
  onClick,
  children,
  title
}: {
  depth: number
  selected?: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      data-current={selected ? 'true' : undefined}
      className={cn(
        'flex h-6 w-full min-w-0 items-center gap-1.5 pr-2 text-left text-xs',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
      style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function groupLabel(node: GitLogBranchTreeNode): string {
  if (node.kind !== 'group') {
    return node.label
  }
  return node.key === 'local'
    ? translate('bottomPanel.gitLog.localBranches', 'Local')
    : translate('bottomPanel.gitLog.remoteBranches', 'Remote')
}

function BranchTreeMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">{children}</div>
}

export function GitLogBranchTree({
  branchList,
  scope,
  onScopeChange
}: GitLogBranchTreeProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const branches = useMemo(
    () => (typeof branchList === 'object' ? branchList.branches : NO_BRANCHES),
    [branchList]
  )
  const isFiltering = query.trim().length > 0
  const rows = useMemo(
    () =>
      flattenGitLogBranchTree(buildGitLogBranchTree(branches, query), collapsedKeys, {
        isFiltering
      }),
    [branches, collapsedKeys, isFiltering, query]
  )

  const toggleCollapsed = (key: string): void => {
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

  const renderRows = (): React.ReactNode => {
    if (branchList === undefined) {
      return (
        <BranchTreeMessage>
          {translate('bottomPanel.gitLog.branchesLoading', 'Loading branches…')}
        </BranchTreeMessage>
      )
    }
    if (branchList === 'unsupported') {
      return (
        <BranchTreeMessage>
          {translate(
            'bottomPanel.gitLog.branchesUnsupported',
            'Update Orca on this host to browse branches.'
          )}
        </BranchTreeMessage>
      )
    }
    if (rows.length === 0) {
      return (
        <BranchTreeMessage>
          {translate('bottomPanel.gitLog.noBranches', 'No matching branches')}
        </BranchTreeMessage>
      )
    }
    return rows.map(({ node, depth }) => {
      if (node.kind === 'branch') {
        const selected = scope.kind === 'ref' && scope.fullName === node.branch.fullName
        return (
          <TreeRow
            key={node.key}
            depth={depth}
            selected={selected}
            title={
              node.branch.upstream
                ? `${node.branch.name} → ${node.branch.upstream}`
                : node.branch.name
            }
            onClick={() => onScopeChange({ kind: 'ref', fullName: node.branch.fullName })}
          >
            {node.branch.isHead ? (
              <Star
                className="size-3.5 shrink-0 fill-current text-git-graph-ref"
                aria-label={translate('bottomPanel.gitLog.currentBranch', 'Current branch')}
              />
            ) : (
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.label}</span>
          </TreeRow>
        )
      }
      const collapsed = !isFiltering && collapsedKeys.has(node.key)
      return (
        <TreeRow key={node.key} depth={depth} onClick={() => toggleCollapsed(node.key)}>
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90'
            )}
          />
          {node.kind === 'folder' ? (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate">{groupLabel(node)}</span>
        </TreeRow>
      )
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="git-log-branch-tree">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate('bottomPanel.gitLog.branchSearch', 'Branch')}
          aria-label={translate('bottomPanel.gitLog.branchSearch', 'Branch')}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
        />
        {query ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={translate('bottomPanel.gitLog.clearBranchSearch', 'Clear branch search')}
            onClick={() => setQuery('')}
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek py-1">
        <TreeRow
          depth={0}
          selected={scope.kind === 'head'}
          onClick={() => onScopeChange(HEAD_GIT_LOG_SCOPE)}
        >
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {translate('bottomPanel.gitLog.headScope', 'HEAD (Current Branch)')}
          </span>
        </TreeRow>
        <TreeRow
          depth={0}
          selected={scope.kind === 'all'}
          onClick={() => onScopeChange(ALL_GIT_LOG_SCOPE)}
        >
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {translate('bottomPanel.gitLog.allScope', 'All Branches')}
          </span>
        </TreeRow>
        {renderRows()}
        {typeof branchList === 'object' && branchList.truncated ? (
          <BranchTreeMessage>
            {translate(
              'bottomPanel.gitLog.branchesTruncated',
              'Only the first {{value0}} branches are listed.',
              { value0: branchList.branches.length }
            )}
          </BranchTreeMessage>
        ) : null}
      </div>
    </div>
  )
}
