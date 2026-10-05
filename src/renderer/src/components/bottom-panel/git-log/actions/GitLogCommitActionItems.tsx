import React from 'react'
import { Cherry, GitBranchPlus, LogIn, RotateCcw, Tag, Undo2 } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItem } from '../../../../../../shared/git-history'
import { useGitLogActionDialogStore } from './git-log-action-dialog-store'
import { currentLabel, shortCommit } from './git-log-action-feedback'
import { GitLogMenuLabel } from './GitLogMenuLabel'
import { useGitLogActions } from './git-log-actions-context'

type CommitActionItemsProps = {
  item: GitHistoryItem
  /** Selected commit ids, newest first; the menu acts on all of them when `item` is one. */
  selectedIds: readonly string[]
  isOnCurrentBranch: (id: string) => boolean
}

/** JetBrains' commit actions, appended to a Git Log row's right-click menu. */
export function GitLogCommitActionItems({
  item,
  selectedIds,
  isOnCurrentBranch
}: CommitActionItemsProps): React.JSX.Element | null {
  const actions = useGitLogActions()
  const openDialog = useGitLogActionDialogStore((s) => s.open)
  if (!actions) {
    return null
  }
  const busy = actions.runningKind !== null
  const targets = selectedIds.includes(item.id) ? selectedIds : [item.id]
  // Why: git applies picks in the order given, so oldest first; reverts undo newest first.
  const toPick = targets.filter((id) => !isOnCurrentBranch(id)).toReversed()
  const toRevert = targets.filter((id) => isOnCurrentBranch(id))
  const label = shortCommit(item.id)
  const current = currentLabel(actions.currentBranchName)
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={busy}
        onSelect={() => actions.run({ kind: 'checkoutRevision', commit: item.id, mode: 'safe' })}
      >
        <LogIn />
        <GitLogMenuLabel
          text={translate(
            'bottomPanel.gitLog.actions.checkoutRevision',
            'Checkout Revision “{{hash}}”',
            {
              hash: label
            }
          )}
        />
      </ContextMenuItem>
      <ContextMenuItem
        disabled={busy}
        onSelect={() =>
          openDialog({ kind: 'createBranch', startPoint: item.id, startLabel: label })
        }
      >
        <GitBranchPlus />
        {translate('bottomPanel.gitLog.actions.newBranch', 'New Branch…')}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={busy}
        onSelect={() => openDialog({ kind: 'createTag', commit: item.id, commitLabel: label })}
      >
        <Tag />
        {translate('bottomPanel.gitLog.actions.newTag', 'New Tag…')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={busy}
        onSelect={() => openDialog({ kind: 'reset', commit: item.id, commitLabel: label })}
      >
        <RotateCcw />
        <GitLogMenuLabel
          text={translate(
            'bottomPanel.gitLog.actions.resetToHere',
            'Reset “{{current}}” to Here…',
            {
              current
            }
          )}
        />
      </ContextMenuItem>
      <ContextMenuItem
        disabled={busy || toRevert.length === 0}
        onSelect={() => actions.run({ kind: 'revert', commits: [...toRevert] })}
      >
        <Undo2 />
        {toRevert.length > 1
          ? translate('bottomPanel.gitLog.actions.revertMany', 'Revert {{count}} Commits', {
              count: toRevert.length
            })
          : translate('bottomPanel.gitLog.actions.revert', 'Revert Commit')}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={busy || toPick.length === 0}
        onSelect={() => actions.run({ kind: 'cherryPick', commits: toPick })}
      >
        <Cherry />
        {toPick.length > 1
          ? translate(
              'bottomPanel.gitLog.actions.cherryPickMany',
              'Cherry-Pick {{count}} Commits',
              {
                count: toPick.length
              }
            )
          : translate('bottomPanel.gitLog.actions.cherryPick', 'Cherry-Pick')}
      </ContextMenuItem>
    </>
  )
}
