import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { GitBranchAction } from '../../../../../../shared/git-branch-action/git-branch-action-types'
import type { GitLogActionDialogRequest } from './git-log-action-dialog-store'

export type GitLogNameRequest = Extract<
  GitLogActionDialogRequest,
  { kind: 'createBranch' | 'renameBranch' | 'createTag' }
>

// Why a light check: the host runs `git check-ref-format`; this only catches what typing can't fix later.
function invalidNameReason(name: string): string | null {
  const trimmed = name.trim()
  if (/\s/.test(trimmed)) {
    return translate('bottomPanel.gitLog.actions.nameNoSpaces', 'Names cannot contain spaces.')
  }
  if (trimmed.startsWith('-')) {
    return translate('bottomPanel.gitLog.actions.nameNoDash', 'Names cannot start with “-”.')
  }
  return null
}

function dialogTitle(request: GitLogNameRequest): string {
  switch (request.kind) {
    case 'createBranch':
      return translate('bottomPanel.gitLog.actions.newBranchTitle', 'New Branch from “{{name}}”', {
        name: request.startLabel
      })
    case 'renameBranch':
      return translate('bottomPanel.gitLog.actions.renameTitle', 'Rename “{{name}}”', {
        name: request.currentName
      })
    case 'createTag':
      return translate('bottomPanel.gitLog.actions.newTagTitle', 'New Tag on “{{hash}}”', {
        hash: request.commitLabel
      })
  }
}

function buildAction(
  request: GitLogNameRequest,
  name: string,
  checkout: boolean,
  message: string
): GitBranchAction {
  switch (request.kind) {
    case 'createBranch':
      return { kind: 'createBranch', name, startPoint: request.startPoint, checkout }
    case 'renameBranch':
      return { kind: 'renameBranch', ref: request.ref, newName: name }
    case 'createTag':
      return { kind: 'createTag', name, commit: request.commit, message: message.trim() }
  }
}

/** New Branch, Rename and New Tag: one name, plus "checkout" for branches and a message for tags. */
export function GitLogNameForm({
  request,
  onSubmit,
  onClose
}: {
  request: GitLogNameRequest
  onSubmit: (action: GitBranchAction) => void
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(request.kind === 'renameBranch' ? request.currentName : '')
  const [checkout, setCheckout] = useState(true)
  const [message, setMessage] = useState('')
  const reason = invalidNameReason(name)
  const unchanged = request.kind === 'renameBranch' && name.trim() === request.currentName
  const canSubmit = name.trim().length > 0 && reason === null && !unchanged
  const submit = (): void => {
    if (canSubmit) {
      onClose()
      onSubmit(buildAction(request, name.trim(), checkout, message))
    }
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{dialogTitle(request)}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Input
          autoFocus
          value={name}
          aria-label={translate('bottomPanel.gitLog.actions.nameLabel', 'Name')}
          aria-invalid={reason !== null || undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {reason ? <p className="text-xs text-destructive">{reason}</p> : null}
      </div>
      {request.kind === 'createBranch' ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id="git-log-new-branch-checkout"
            checked={checkout}
            onCheckedChange={(checked) => setCheckout(checked === true)}
          />
          <Label htmlFor="git-log-new-branch-checkout">
            {translate('bottomPanel.gitLog.actions.checkoutNewBranch', 'Checkout branch')}
          </Label>
        </div>
      ) : null}
      {request.kind === 'createTag' ? (
        <Textarea
          value={message}
          rows={3}
          placeholder={translate(
            'bottomPanel.gitLog.actions.tagMessage',
            'Message (optional, makes an annotated tag)'
          )}
          aria-label={translate(
            'bottomPanel.gitLog.actions.tagMessage',
            'Message (optional, makes an annotated tag)'
          )}
          onChange={(event) => setMessage(event.target.value)}
        />
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {translate('bottomPanel.gitLog.actions.cancel', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {request.kind === 'renameBranch'
            ? translate('bottomPanel.gitLog.actions.renameConfirm', 'Rename')
            : translate('bottomPanel.gitLog.actions.create', 'Create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
