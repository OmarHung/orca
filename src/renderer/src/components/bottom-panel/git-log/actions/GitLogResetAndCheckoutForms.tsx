import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type {
  GitBranchAction,
  GitResetMode
} from '../../../../../../shared/git-branch-action/git-branch-action-types'
import type { GitLogActionDialogRequest } from './git-log-action-dialog-store'
import { currentLabel } from './git-log-action-feedback'

const MAX_LISTED_FILES = 8
const RESET_MODES: readonly GitResetMode[] = ['soft', 'mixed', 'hard', 'keep']

function resetModeLabel(mode: GitResetMode): string {
  switch (mode) {
    case 'soft':
      return translate('bottomPanel.gitLog.actions.resetSoft', 'Soft')
    case 'mixed':
      return translate('bottomPanel.gitLog.actions.resetMixed', 'Mixed')
    case 'hard':
      return translate('bottomPanel.gitLog.actions.resetHard', 'Hard')
    case 'keep':
      return translate('bottomPanel.gitLog.actions.resetKeep', 'Keep')
  }
}

function resetModeDescription(mode: GitResetMode): string {
  switch (mode) {
    case 'soft':
      return translate(
        'bottomPanel.gitLog.actions.resetSoftDescription',
        'Files stay as they are; the changes of the undone commits become staged.'
      )
    case 'mixed':
      return translate(
        'bottomPanel.gitLog.actions.resetMixedDescription',
        'Files stay as they are; the changes of the undone commits become unstaged.'
      )
    case 'hard':
      return translate(
        'bottomPanel.gitLog.actions.resetHardDescription',
        'Files are changed to match the commit. Uncommitted changes and the undone commits’ changes are lost.'
      )
    case 'keep':
      return translate(
        'bottomPanel.gitLog.actions.resetKeepDescription',
        'Files are changed to match the commit, but uncommitted changes are kept. Stops if they would be lost.'
      )
  }
}

export function GitLogResetForm({
  request,
  currentBranchName,
  onSubmit,
  onClose
}: {
  request: Extract<GitLogActionDialogRequest, { kind: 'reset' }>
  currentBranchName: string | null
  onSubmit: (action: GitBranchAction) => void
  onClose: () => void
}): React.JSX.Element {
  const [mode, setMode] = useState<GitResetMode>('mixed')
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {translate('bottomPanel.gitLog.actions.resetTitle', 'Reset “{{current}}” to “{{hash}}”', {
            current: currentLabel(currentBranchName),
            hash: request.commitLabel
          })}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Select
          value={mode}
          onValueChange={(value) => setMode(RESET_MODES.find((m) => m === value) ?? 'mixed')}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESET_MODES.map((option) => (
              <SelectItem key={option} value={option}>
                {resetModeLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{resetModeDescription(mode)}</p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {translate('bottomPanel.gitLog.actions.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'hard' ? 'destructive' : 'default'}
          onClick={() => {
            onClose()
            onSubmit({ kind: 'reset', commit: request.commit, mode })
          }}
        >
          {translate('bottomPanel.gitLog.actions.reset', 'Reset')}
        </Button>
      </DialogFooter>
    </div>
  )
}

/** Git refused a checkout over local changes: Smart Checkout keeps them, Force drops them. */
export function GitLogLocalChangesForm({
  request,
  onSubmit,
  onClose
}: {
  request: Extract<GitLogActionDialogRequest, { kind: 'localChanges' }>
  onSubmit: (action: GitBranchAction) => void
  onClose: () => void
}): React.JSX.Element {
  const retry = (mode: 'smart' | 'force'): void => {
    onClose()
    const { target } = request
    onSubmit(
      target.kind === 'ref'
        ? { kind: 'checkout', ref: target.ref, mode }
        : { kind: 'checkoutRevision', commit: target.commit, mode }
    )
  }
  const listed = request.files.slice(0, MAX_LISTED_FILES)
  const hidden = request.files.length - listed.length
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {translate(
            'bottomPanel.gitLog.actions.localChangesTitle',
            'Local changes would be overwritten'
          )}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'bottomPanel.gitLog.actions.localChangesDescription',
            'Checking out {{name}} would overwrite your changes to these files. Smart Checkout stashes them, checks out, then re-applies them.',
            { name: request.targetLabel }
          )}
        </DialogDescription>
      </DialogHeader>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto scrollbar-sleek rounded-md border border-border px-2 py-1.5 font-mono text-[11px]">
        {listed.map((file) => (
          <li key={file} className="truncate" title={file}>
            {file}
          </li>
        ))}
        {hidden > 0 ? (
          <li className="text-muted-foreground">
            {translate('bottomPanel.gitLog.actions.moreFiles', '+{{count}} more', {
              count: hidden
            })}
          </li>
        ) : null}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {translate('bottomPanel.gitLog.actions.cancel', 'Cancel')}
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => retry('force')}>
          {translate('bottomPanel.gitLog.actions.forceCheckout', 'Force Checkout')}
        </Button>
        <Button type="button" size="sm" autoFocus onClick={() => retry('smart')}>
          {translate('bottomPanel.gitLog.actions.smartCheckout', 'Smart Checkout')}
        </Button>
      </DialogFooter>
    </div>
  )
}
