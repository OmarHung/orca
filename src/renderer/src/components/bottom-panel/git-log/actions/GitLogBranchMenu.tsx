import React from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranchPlus,
  GitMerge,
  GitPullRequestArrow,
  LogIn,
  Pencil,
  Trash2
} from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import type { GitHistoryBranch } from '../../../../../../shared/git-history'
import {
  GitLogBranchCompareItems,
  type GitLogCompareHandler
} from '../compare/GitLogCompareMenuItems'
import { useGitLogActionDialogStore } from './git-log-action-dialog-store'
import { currentLabel } from './git-log-action-feedback'
import { GitLogMenuLabel } from './GitLogMenuLabel'
import { useGitLogActions, type GitLogActions } from './git-log-actions-context'

type BranchMenuProps = {
  branch: GitHistoryBranch
  branches: readonly GitHistoryBranch[]
  onCompare: GitLogCompareHandler
}

/** Checkout / New Branch / Checkout and Rebase: JetBrains' top group. */
function BranchCheckoutItems({
  branch,
  actions
}: {
  branch: GitHistoryBranch
  actions: GitLogActions
}): React.JSX.Element {
  const openDialog = useGitLogActionDialogStore((s) => s.open)
  const busy = actions.runningKind !== null
  const current = currentLabel(actions.currentBranchName)
  return (
    <>
      {branch.isHead ? null : (
        <ContextMenuItem
          disabled={busy}
          onSelect={() => actions.run({ kind: 'checkout', ref: branch.fullName, mode: 'safe' })}
        >
          <LogIn />
          {translate('bottomPanel.gitLog.actions.checkout', 'Checkout')}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        disabled={busy}
        onSelect={() =>
          openDialog({ kind: 'createBranch', startPoint: branch.fullName, startLabel: branch.name })
        }
      >
        <GitBranchPlus />
        <GitLogMenuLabel
          text={translate(
            'bottomPanel.gitLog.actions.newBranchFrom',
            'New Branch from “{{name}}”…',
            {
              name: branch.name
            }
          )}
        />
      </ContextMenuItem>
      {branch.isHead || branch.kind !== 'local' ? null : (
        <ContextMenuItem
          disabled={busy}
          onSelect={() => actions.run({ kind: 'checkoutAndRebase', ref: branch.fullName })}
        >
          <GitPullRequestArrow />
          <GitLogMenuLabel
            text={translate(
              'bottomPanel.gitLog.actions.checkoutAndRebase',
              'Checkout and Rebase onto “{{current}}”',
              { current }
            )}
          />
        </ContextMenuItem>
      )}
    </>
  )
}

/** Rebase / Merge / Pull into the current branch. */
function BranchIntegrationItems({
  branch,
  actions
}: {
  branch: GitHistoryBranch
  actions: GitLogActions
}): React.JSX.Element {
  const busy = actions.runningKind !== null
  const current = currentLabel(actions.currentBranchName)
  const names = { name: branch.name, current }
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={busy}
        onSelect={() => actions.run({ kind: 'rebase', ref: branch.fullName })}
      >
        <GitPullRequestArrow />
        <GitLogMenuLabel
          text={translate(
            'bottomPanel.gitLog.actions.rebaseOnto',
            'Rebase “{{current}}” onto “{{name}}”',
            names
          )}
        />
      </ContextMenuItem>
      <ContextMenuItem
        disabled={busy}
        onSelect={() => actions.run({ kind: 'merge', ref: branch.fullName })}
      >
        <GitMerge />
        <GitLogMenuLabel
          text={translate(
            'bottomPanel.gitLog.actions.mergeInto',
            'Merge “{{name}}” into “{{current}}”',
            names
          )}
        />
      </ContextMenuItem>
      {branch.kind === 'remote' ? (
        <>
          <ContextMenuItem
            disabled={busy}
            onSelect={() => actions.run({ kind: 'pull', ref: branch.fullName, strategy: 'rebase' })}
          >
            <ArrowDownToLine />
            <GitLogMenuLabel
              text={translate(
                'bottomPanel.gitLog.actions.pullRebase',
                'Pull into “{{current}}” Using Rebase',
                names
              )}
            />
          </ContextMenuItem>
          <ContextMenuItem
            disabled={busy}
            onSelect={() => actions.run({ kind: 'pull', ref: branch.fullName, strategy: 'merge' })}
          >
            <ArrowDownToLine />
            <GitLogMenuLabel
              text={translate(
                'bottomPanel.gitLog.actions.pullMerge',
                'Pull into “{{current}}” Using Merge',
                names
              )}
            />
          </ContextMenuItem>
        </>
      ) : null}
    </>
  )
}

/** Push / Rename / Delete. */
function BranchManageItems({
  branch,
  actions
}: {
  branch: GitHistoryBranch
  actions: GitLogActions
}): React.JSX.Element {
  const openDialog = useGitLogActionDialogStore((s) => s.open)
  const confirm = useConfirmationDialog()
  const busy = actions.runningKind !== null
  const isLocal = branch.kind === 'local'
  const deleteBranch = (): void => {
    if (isLocal) {
      // Why: `branch -d` already refuses unmerged work; the follow-up asks before forcing.
      actions.run({ kind: 'deleteBranch', ref: branch.fullName, force: false })
      return
    }
    void confirm({
      title: translate('bottomPanel.gitLog.actions.deleteRemoteTitle', 'Delete remote branch?'),
      description: translate(
        'bottomPanel.gitLog.actions.deleteRemoteDescription',
        '{{name}} will be deleted on the remote for everyone who uses it.',
        { name: branch.name }
      ),
      confirmLabel: translate('bottomPanel.gitLog.actions.delete', 'Delete'),
      confirmVariant: 'destructive'
    }).then((confirmed) => {
      if (confirmed) {
        actions.run({ kind: 'deleteBranch', ref: branch.fullName, force: false })
      }
    })
  }
  return (
    <>
      <ContextMenuSeparator />
      {isLocal ? (
        <ContextMenuItem
          disabled={busy}
          onSelect={() => actions.run({ kind: 'push', ref: branch.fullName })}
        >
          <ArrowUpFromLine />
          {translate('bottomPanel.gitLog.actions.push', 'Push')}
        </ContextMenuItem>
      ) : null}
      {isLocal ? (
        <ContextMenuItem
          disabled={busy}
          onSelect={() =>
            openDialog({ kind: 'renameBranch', ref: branch.fullName, currentName: branch.name })
          }
        >
          <Pencil />
          {translate('bottomPanel.gitLog.actions.rename', 'Rename…')}
        </ContextMenuItem>
      ) : null}
      {branch.isHead ? null : (
        <ContextMenuItem variant="destructive" disabled={busy} onSelect={deleteBranch}>
          <Trash2 />
          {translate('bottomPanel.gitLog.actions.delete', 'Delete')}
        </ContextMenuItem>
      )}
    </>
  )
}

/** Right-click menu for a branch in the Git Log branch tree, ordered like JetBrains' branch popup. */
export function GitLogBranchMenu({
  branch,
  branches,
  onCompare
}: BranchMenuProps): React.JSX.Element {
  const actions = useGitLogActions()
  return (
    <ContextMenuContent className="w-72">
      {actions ? (
        <>
          <BranchCheckoutItems branch={branch} actions={actions} />
          <ContextMenuSeparator />
        </>
      ) : null}
      <GitLogBranchCompareItems branch={branch} branches={branches} onCompare={onCompare} />
      {actions && !branch.isHead ? (
        <BranchIntegrationItems branch={branch} actions={actions} />
      ) : null}
      {actions ? <BranchManageItems branch={branch} actions={actions} /> : null}
    </ContextMenuContent>
  )
}
