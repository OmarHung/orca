import React from 'react'
import { CircleDot, GitCompareArrows } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import type { GitHistoryBranch, GitHistoryItem } from '../../../../../../shared/git-history'
import {
  branchCompareTarget,
  commitCompareTarget,
  isSameCompareTarget,
  orderCommitPair,
  type GitLogCompareTarget
} from './git-log-compare-target'
import { useGitLogCompareStore } from './git-log-compare-store'

export type GitLogCompareHandler = (base: GitLogCompareTarget, target: GitLogCompareTarget) => void

/** "Select for Compare" and "Compare with …", shared by commit and branch menus. */
function SelectAndCompareItems({
  target,
  onCompare
}: {
  target: GitLogCompareTarget
  onCompare: GitLogCompareHandler
}): React.JSX.Element {
  const selected = useGitLogCompareStore((s) => s.selected)
  const select = useGitLogCompareStore((s) => s.select)
  return (
    <>
      <ContextMenuItem onSelect={() => select(target)}>
        <CircleDot className="size-3.5" />
        {translate('bottomPanel.gitLog.compare.select', 'Select for Compare')}
      </ContextMenuItem>
      {selected && !isSameCompareTarget(selected, target) ? (
        <ContextMenuItem onSelect={() => onCompare(selected, target)}>
          <GitCompareArrows className="size-3.5" />
          {translate('bottomPanel.gitLog.compare.withSelected', 'Compare with “{{name}}”', {
            name: selected.label
          })}
        </ContextMenuItem>
      ) : null}
    </>
  )
}

/** Compare entries appended to a Git Log commit row's menu. */
export function GitLogCommitCompareItems({
  item,
  selectedPair,
  logOrder,
  onCompare
}: {
  item: GitHistoryItem
  selectedPair: readonly [string, string] | null
  logOrder: readonly string[]
  onCompare: GitLogCompareHandler
}): React.JSX.Element {
  const pair = selectedPair?.includes(item.id) ? selectedPair : null
  return (
    <>
      <ContextMenuSeparator />
      {pair ? (
        <ContextMenuItem
          onSelect={() => {
            const { base, target } = orderCommitPair(pair, logOrder)
            onCompare(commitCompareTarget({ id: base }), commitCompareTarget({ id: target }))
          }}
        >
          <GitCompareArrows className="size-3.5" />
          {translate('bottomPanel.gitLog.compare.versions', 'Compare Versions')}
        </ContextMenuItem>
      ) : null}
      <SelectAndCompareItems target={commitCompareTarget(item)} onCompare={onCompare} />
    </>
  )
}

/** Compare entries of the branch tree's right-click menu. */
export function GitLogBranchCompareItems({
  branch,
  branches,
  onCompare
}: {
  branch: GitHistoryBranch
  branches: readonly GitHistoryBranch[]
  onCompare: GitLogCompareHandler
}): React.JSX.Element {
  const target = branchCompareTarget(branch)
  const head = branches.find((candidate) => candidate.isHead)
  const others = branches.filter((candidate) => candidate.fullName !== branch.fullName)
  return (
    <>
      <ContextMenuItem
        disabled={!head || branch.isHead}
        onSelect={() => head && onCompare(branchCompareTarget(head), target)}
      >
        <GitCompareArrows className="size-3.5" />
        {translate('bottomPanel.gitLog.compare.withCurrent', 'Compare with Current Branch')}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={others.length === 0}>
          <GitCompareArrows className="size-3.5" />
          {translate('bottomPanel.gitLog.compare.withBranch', 'Compare with Branch')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {/* Why a wrapper: a repo can have more branches than fit on screen. */}
          <div className="max-h-72 overflow-y-auto scrollbar-sleek">
            {others.map((other) => (
              <ContextMenuItem
                key={other.fullName}
                onSelect={() => onCompare(branchCompareTarget(other), target)}
              >
                {other.name}
              </ContextMenuItem>
            ))}
          </div>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <SelectAndCompareItems target={target} onCompare={onCompare} />
    </>
  )
}
