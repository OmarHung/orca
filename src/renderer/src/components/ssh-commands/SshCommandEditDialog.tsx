import { useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { syncSshCommandParams } from '../../../../shared/ssh-command-template'
import type { SshCommand, SshCommandDraft } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import {
  EMPTY_SSH_COMMAND_DRAFT,
  reviewSshCommandDraft,
  type SshCommandDraftProblem
} from './ssh-command-draft'
import { SshCommandParamRow } from './SshCommandParamRow'
import { SshCommandScopeField } from './SshCommandScopeField'
import { useSshCommandsStore } from './ssh-commands-store'

/** `command` is null when adding a new one. */
export type SshCommandEditRequest = { command: SshCommand | null }

function draftFrom(command: SshCommand | null): SshCommandDraft {
  if (!command) {
    return EMPTY_SSH_COMMAND_DRAFT
  }
  const { name, template, params, runMode, scope } = command
  return { name, template, params, runMode, scope }
}

/** Only what the user can act on: an empty form isn't an error until they've typed something. */
function problemMessage(problem: SshCommandDraftProblem): string | null {
  switch (problem.kind) {
    case 'emptyName':
    case 'emptyTemplate':
      return null
    case 'unsafeTemplate':
      return translate(
        'sshCommands.edit.unsafeTemplate',
        'The template contains a control character that could drive the terminal.'
      )
    case 'quotedKey':
      return translate(
        'sshCommands.edit.quotedKey',
        '{{key}} is inside quotes, where its value could close them. Remove the quotes around it, or set it to “Insert as written”.',
        { key: `{{${problem.key}}}` }
      )
    case 'noHosts':
      return translate('sshCommands.edit.noHosts', 'Choose at least one host.')
    case 'noGroup':
      return translate('sshCommands.edit.noGroup', 'Choose a group.')
    case 'noOptions':
      return translate('sshCommands.edit.noOptions', 'Add options for {{key}}.', {
        key: `{{${problem.key}}}`
      })
    case 'defaultNotAnOption':
      return translate(
        'sshCommands.edit.defaultNotAnOption',
        'The default value of {{key}} must be one of its options.',
        { key: `{{${problem.key}}}` }
      )
  }
}

function EditDialogBody({
  request,
  targets,
  onClose
}: {
  request: SshCommandEditRequest
  targets: readonly SshTarget[]
  onClose: () => void
}): React.JSX.Element {
  const save = useSshCommandsStore((s) => s.save)
  const [draft, setDraft] = useState(() => draftFrom(request.command))
  const [isSaving, setIsSaving] = useState(false)
  const review = reviewSshCommandDraft(draft)

  const submit = async (): Promise<void> => {
    setIsSaving(true)
    try {
      await save(request.command?.id, draft)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setIsSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {request.command
            ? translate('sshCommands.edit.titleEdit', 'Edit command')
            : translate('sshCommands.edit.titleNew', 'New command')}
        </DialogTitle>
      </DialogHeader>
      <div className="scrollbar-sleek flex max-h-[60vh] min-w-0 flex-col gap-4 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssh-command-name" variant="settings">
            {translate('sshCommands.edit.name', 'Name')}
          </Label>
          <Input
            id="ssh-command-name"
            autoFocus
            value={draft.name}
            density="compact"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssh-command-template" variant="settings">
            {translate('sshCommands.edit.template', 'Command')}
          </Label>
          <Textarea
            id="ssh-command-template"
            rows={3}
            spellCheck={false}
            value={draft.template}
            placeholder="journalctl -u {{service}} -n {{lines}} --no-pager"
            variant="code"
            onChange={(event) => {
              const template = event.target.value
              setDraft({
                ...draft,
                template,
                params: syncSshCommandParams(template, draft.params).params
              })
            }}
          />
          <p className="text-xs text-muted-foreground">
            {translate(
              'sshCommands.edit.templateHint',
              'Write {{name}} for a value to fill in. Built in: {{host}} {{user}} {{path}} {{selected}}, the last two from the files pane.',
              // Why: these are the literal placeholders to show, not values to interpolate.
              {
                name: '{{name}}',
                host: '{{host}}',
                user: '{{user}}',
                path: '{{path}}',
                selected: '{{selected}}'
              }
            )}
          </p>
          {/\r|\n/.test(draft.template.trim()) ? (
            <p data-ssh-command-multiline className="text-xs text-muted-foreground">
              {translate(
                'sshCommands.edit.multiLine',
                'Lines are joined into one with ; so a later line still runs if an earlier one fails. Use && to stop on failure.'
              )}
            </p>
          ) : null}
          {review.literalTokens.length > 0 ? (
            <p data-ssh-command-literal className="text-xs text-muted-foreground">
              {translate(
                'sshCommands.edit.literalTokens',
                'Sent as written, not as parameters: {{tokens}}',
                { tokens: review.literalTokens.join(' ') }
              )}
            </p>
          ) : null}
        </div>
        {draft.params.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium">
              {translate('sshCommands.edit.params', 'Parameters')}
            </span>
            {draft.params.map((param) => (
              <SshCommandParamRow
                key={param.key}
                param={param}
                isUnused={review.unusedKeys.includes(param.key)}
                onChange={(next) =>
                  setDraft({
                    ...draft,
                    params: draft.params.map((row) => (row.key === next.key ? next : row))
                  })
                }
                onDelete={() =>
                  setDraft({
                    ...draft,
                    params: draft.params.filter((row) => row.key !== param.key)
                  })
                }
              />
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssh-command-run-mode" variant="settings">
            {translate('sshCommands.edit.runMode', 'When chosen')}
          </Label>
          <Select
            value={draft.runMode}
            onValueChange={(runMode: SshCommandDraft['runMode']) => setDraft({ ...draft, runMode })}
          >
            <SelectTrigger id="ssh-command-run-mode" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="insert">
                {translate('sshCommands.edit.runModeInsert', 'Paste, and let me press Enter')}
              </SelectItem>
              <SelectItem value="run">
                {translate('sshCommands.edit.runModeRun', 'Offer to run it')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SshCommandScopeField
          scope={draft.scope}
          targets={targets}
          onChange={(scope) => setDraft({ ...draft, scope })}
        />
        {review.problems.map((problem) => {
          const message = problemMessage(problem)
          return message ? (
            <p
              key={'key' in problem ? `${problem.kind}:${problem.key}` : problem.kind}
              data-ssh-command-draft-problem={problem.kind}
              className="text-xs text-destructive"
            >
              {message}
            </p>
          ) : null
        })}
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          {translate('sshCommands.edit.cancel', 'Cancel')}
        </Button>
        <Button
          size="sm"
          data-ssh-command-save
          disabled={review.problems.length > 0 || isSaving}
          onClick={() => void submit()}
        >
          {translate('sshCommands.edit.save', 'Save')}
        </Button>
      </DialogFooter>
    </>
  )
}

export function SshCommandEditDialog({
  request,
  targets,
  onClose
}: {
  request: SshCommandEditRequest | null
  targets: readonly SshTarget[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-ssh-command-edit-dialog>
        {request ? <EditDialogBody request={request} targets={targets} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}
