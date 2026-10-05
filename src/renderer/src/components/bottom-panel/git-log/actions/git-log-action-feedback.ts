import { translate } from '@/i18n/i18n'
import { shortBranchName } from '../../../../../../shared/git-branch-action/git-branch-action-refs'
import type {
  GitBranchAction,
  GitBranchActionConflictOperation
} from '../../../../../../shared/git-branch-action/git-branch-action-types'

const SHORT_HASH_LENGTH = 8

export function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_HASH_LENGTH)
}

/** Label for the checked-out branch in messages; a detached HEAD reads as "HEAD". */
export function currentLabel(currentBranchName: string | null): string {
  return currentBranchName ?? 'HEAD'
}

/** Shown while a slower action runs (after a short delay, so fast local runs stay quiet). */
export function gitLogActionProgress(action: GitBranchAction): string {
  switch (action.kind) {
    case 'fetch':
      return translate('bottomPanel.gitLog.actions.progress.fetch', 'Fetching…')
    case 'push':
      return translate('bottomPanel.gitLog.actions.progress.push', 'Pushing {{name}}…', {
        name: shortBranchName(action.ref)
      })
    case 'pull':
      return translate('bottomPanel.gitLog.actions.progress.pull', 'Pulling {{name}}…', {
        name: shortBranchName(action.ref)
      })
    case 'rebase':
    case 'checkoutAndRebase':
      return translate('bottomPanel.gitLog.actions.progress.rebase', 'Rebasing…')
    case 'merge':
      return translate('bottomPanel.gitLog.actions.progress.merge', 'Merging…')
    case 'deleteBranch':
      return translate('bottomPanel.gitLog.actions.progress.delete', 'Deleting {{name}}…', {
        name: shortBranchName(action.ref)
      })
    case 'checkout':
    case 'checkoutRevision':
    case 'createBranch':
    case 'renameBranch':
    case 'cherryPick':
    case 'revert':
    case 'reset':
    case 'createTag':
    case 'abortOperation':
      return translate('bottomPanel.gitLog.actions.progress.generic', 'Running git…')
  }
}

export function gitLogActionSuccess(action: GitBranchAction, current: string | null): string {
  const cur = currentLabel(current)
  switch (action.kind) {
    case 'fetch':
      return translate('bottomPanel.gitLog.actions.done.fetch', 'Fetched all remotes')
    case 'checkout':
      return translate('bottomPanel.gitLog.actions.done.checkout', 'Checked out {{name}}', {
        name: shortBranchName(action.ref)
      })
    case 'checkoutRevision':
      return translate(
        'bottomPanel.gitLog.actions.done.checkoutRevision',
        'Checked out {{hash}} (detached HEAD)',
        {
          hash: shortCommit(action.commit)
        }
      )
    case 'createBranch':
      return action.checkout
        ? translate(
            'bottomPanel.gitLog.actions.done.createAndCheckout',
            'Created and checked out {{name}}',
            {
              name: action.name
            }
          )
        : translate('bottomPanel.gitLog.actions.done.createBranch', 'Created branch {{name}}', {
            name: action.name
          })
    case 'renameBranch':
      return translate('bottomPanel.gitLog.actions.done.rename', 'Renamed {{from}} to {{to}}', {
        from: shortBranchName(action.ref),
        to: action.newName
      })
    case 'deleteBranch':
      return translate('bottomPanel.gitLog.actions.done.delete', 'Deleted {{name}}', {
        name: shortBranchName(action.ref)
      })
    case 'merge':
      return translate(
        'bottomPanel.gitLog.actions.done.merge',
        'Merged {{name}} into {{current}}',
        {
          name: shortBranchName(action.ref),
          current: cur
        }
      )
    case 'rebase':
      return translate(
        'bottomPanel.gitLog.actions.done.rebase',
        'Rebased {{current}} onto {{name}}',
        {
          name: shortBranchName(action.ref),
          current: cur
        }
      )
    case 'checkoutAndRebase':
      return translate(
        'bottomPanel.gitLog.actions.done.checkoutAndRebase',
        'Rebased {{name}} onto {{current}}',
        {
          name: shortBranchName(action.ref),
          current: cur
        }
      )
    case 'pull':
      return translate('bottomPanel.gitLog.actions.done.pull', 'Pulled {{name}} into {{current}}', {
        name: shortBranchName(action.ref),
        current: cur
      })
    case 'push':
      return translate('bottomPanel.gitLog.actions.done.push', 'Pushed {{name}}', {
        name: shortBranchName(action.ref)
      })
    case 'cherryPick':
      return translate(
        'bottomPanel.gitLog.actions.done.cherryPick',
        'Cherry-picked {{count}} commit(s)',
        {
          count: action.commits.length
        }
      )
    case 'revert':
      return translate('bottomPanel.gitLog.actions.done.revert', 'Reverted {{count}} commit(s)', {
        count: action.commits.length
      })
    case 'reset':
      return translate('bottomPanel.gitLog.actions.done.reset', 'Reset {{current}} to {{hash}}', {
        current: cur,
        hash: shortCommit(action.commit)
      })
    case 'createTag':
      return translate('bottomPanel.gitLog.actions.done.createTag', 'Created tag {{name}}', {
        name: action.name
      })
    case 'abortOperation':
      return translate('bottomPanel.gitLog.actions.done.abort', 'Aborted')
  }
}

export function gitLogConflictMessage(operation: GitBranchActionConflictOperation): string {
  switch (operation) {
    case 'merge':
      return translate('bottomPanel.gitLog.actions.conflicts.merge', 'Merge stopped on conflicts')
    case 'rebase':
      return translate('bottomPanel.gitLog.actions.conflicts.rebase', 'Rebase stopped on conflicts')
    case 'cherry-pick':
      return translate('bottomPanel.gitLog.actions.conflicts.cherryPick', 'Cherry-pick stopped')
    case 'revert':
      return translate('bottomPanel.gitLog.actions.conflicts.revert', 'Revert stopped on conflicts')
    case 'stash':
      return translate(
        'bottomPanel.gitLog.actions.conflicts.stash',
        'Checked out, but your local changes conflict'
      )
  }
}

export function gitLogConflictDescription(operation: GitBranchActionConflictOperation): string {
  return operation === 'stash'
    ? translate(
        'bottomPanel.gitLog.actions.conflicts.stashDescription',
        'Resolve the conflicted files in Source Control. Your changes are also kept in the stash.'
      )
    : translate(
        'bottomPanel.gitLog.actions.conflicts.description',
        'Resolve the conflicts in Source Control and continue, or abort.'
      )
}
