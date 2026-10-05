import React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { GitBranchAction } from '../../../../../../shared/git-branch-action/git-branch-action-types'
import {
  useGitLogActionDialogStore,
  type GitLogActionDialogRequest
} from './git-log-action-dialog-store'
import { useGitLogActions } from './git-log-actions-context'
import { GitLogNameForm } from './GitLogNameDialog'
import { GitLogLocalChangesForm, GitLogResetForm } from './GitLogResetAndCheckoutForms'

function GitLogActionForm({
  request,
  currentBranchName,
  onSubmit,
  onClose
}: {
  request: GitLogActionDialogRequest
  currentBranchName: string | null
  onSubmit: (action: GitBranchAction) => void
  onClose: () => void
}): React.JSX.Element {
  switch (request.kind) {
    case 'createBranch':
    case 'renameBranch':
    case 'createTag':
      return <GitLogNameForm request={request} onSubmit={onSubmit} onClose={onClose} />
    case 'reset':
      return (
        <GitLogResetForm
          request={request}
          currentBranchName={currentBranchName}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      )
    case 'localChanges':
      return <GitLogLocalChangesForm request={request} onSubmit={onSubmit} onClose={onClose} />
  }
}

/** Hosts the dialog a Git Log menu asked for; it runs through the same action queue as the menus. */
export function GitLogActionDialogs(): React.JSX.Element {
  const request = useGitLogActionDialogStore((s) => s.request)
  const close = useGitLogActionDialogStore((s) => s.close)
  const actions = useGitLogActions()
  return (
    <Dialog open={request !== null && actions !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className={cn(
          'max-w-sm sm:max-w-sm',
          request?.kind === 'localChanges' && 'max-w-md sm:max-w-md'
        )}
      >
        {request && actions ? (
          <GitLogActionForm
            key={JSON.stringify(request)}
            request={request}
            currentBranchName={actions.currentBranchName}
            onSubmit={actions.run}
            onClose={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
