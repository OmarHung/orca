import { useEffect, useMemo, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { CommandList } from '../command-confirm/CommandList'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  expandSshCommandTemplate,
  syncSshCommandParams,
  type SshCommandProblem
} from '../../../../shared/ssh-command-template'
import type { SshCommand, SshCommandParam } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useRemoteSessionStore } from '../ssh-page/remote-session-store'
import {
  checkSshCommandTarget,
  sendSshCommand,
  sshCommandBlockMessage,
  sshCommandRemotePlatform,
  type SshCommandDoubt,
  type SshCommandTargetCheck
} from './ssh-command-send'
import { initialSshCommandValues, rememberSshCommandValues } from './ssh-command-values'

export type SshCommandRunRequest = { command: SshCommand; tabId: string; target: SshTarget }

// Why: Radix Select can't hold an empty value, and an optional option may be left out.
const NO_OPTION = '__none__'

const EMPTY_SELECTION: readonly string[] = []

function problemMessage(problem: SshCommandProblem, labelOf: (key: string) => string): string {
  const name = labelOf(problem.key)
  switch (problem.kind) {
    case 'missingValue':
      return translate('sshCommands.run.missingValue', '“{{name}}” needs a value.', { name })
    case 'controlCharacter':
      return translate(
        'sshCommands.run.controlCharacter',
        '“{{name}}” contains a line break or control character, which could run something else.',
        { name }
      )
    case 'notANumber':
      return translate('sshCommands.run.notANumber', '“{{name}}” must be a number.', { name })
    case 'notAnOption':
      return translate('sshCommands.run.notAnOption', 'Choose one of the options for “{{name}}”.', {
        name
      })
    case 'windowsNeedsRaw':
      return translate(
        'sshCommands.run.windowsNeedsRaw',
        '“{{name}}” can’t be quoted for a Windows host. Set it to “Insert as written” or use a list.',
        { name }
      )
    case 'insideQuotes':
      return translate(
        'sshCommands.run.insideQuotes',
        '“{{name}}” is inside quotes in the template, where its value could close them. Edit the command to remove them.',
        { name }
      )
    case 'noPath':
      return translate(
        'sshCommands.run.noPath',
        'This uses the folder in the files pane. Open this tab’s files first.'
      )
    case 'noSelection':
      return translate(
        'sshCommands.run.noSelection',
        'This uses the items selected in the files pane. Select something first.'
      )
    case 'undefinedParam':
      return translate(
        'sshCommands.run.undefinedParam',
        '“{{name}}” isn’t defined. Edit the command.',
        {
          name
        }
      )
  }
}

function doubtMessage(doubt: SshCommandDoubt): string {
  return doubt === 'manualSsh'
    ? translate(
        'sshCommands.run.manualSsh',
        'ssh was started again in this tab outside Orca, so it may be connected to another host. Check the terminal first.'
      )
    : translate(
        'sshCommands.run.unverified',
        'Orca can’t confirm this tab is still connected here. If ssh has ended, the command runs on your computer.'
      )
}

function ParamField({
  param,
  value,
  onChange
}: {
  param: SshCommandParam
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const id = `ssh-command-param-${param.key}`
  return (
    <div className="flex flex-col gap-1.5" data-ssh-command-param={param.key}>
      <Label htmlFor={id} variant="settings">
        {param.label || param.key}
        {param.required ? null : (
          <span className="font-normal text-muted-foreground">
            {translate('sshCommands.run.optional', 'Optional')}
          </span>
        )}
        {param.quote === 'raw' ? (
          <Badge variant="outline">
            {translate('sshCommands.run.rawBadge', 'Inserted as written')}
          </Badge>
        ) : null}
      </Label>
      {param.kind === 'select' ? (
        <Select
          value={value === '' ? NO_OPTION : value}
          onValueChange={(next) => onChange(next === NO_OPTION ? '' : next)}
        >
          <SelectTrigger id={id} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {param.required ? null : (
              <SelectItem value={NO_OPTION}>
                {translate('sshCommands.run.noOption', 'None')}
              </SelectItem>
            )}
            {(param.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          value={value}
          spellCheck={false}
          inputMode={param.kind === 'number' ? 'decimal' : undefined}
          variant="code"
          density="compact"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

function RunDialogBody({
  request,
  onClose
}: {
  request: SshCommandRunRequest
  onClose: () => void
}): React.JSX.Element {
  const { command, tabId, target } = request
  const remotePath = useRemoteSessionStore((s) => s.remotePathByTab[tabId] ?? null)
  const selected = useRemoteSessionStore((s) => s.remoteSelectionByTab[tabId] ?? EMPTY_SELECTION)
  const params = useMemo(() => {
    const { params: rows, unusedKeys } = syncSshCommandParams(command.template, command.params)
    return rows.filter((param) => !unusedKeys.includes(param.key))
  }, [command.params, command.template])
  const [values, setValues] = useState(() => initialSshCommandValues(command.id, params))
  const [check, setCheck] = useState<SshCommandTargetCheck | null>(null)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    let isCancelled = false
    void checkSshCommandTarget(tabId).then((result) => {
      if (!isCancelled) {
        setCheck(result)
      }
    })
    return () => {
      isCancelled = true
    }
  }, [tabId])

  const expansion = expandSshCommandTemplate({
    template: command.template,
    params,
    values,
    builtins: {
      host: target.host,
      user: target.username,
      path: remotePath,
      selected
    },
    remotePlatform: sshCommandRemotePlatform(tabId, target.id)
  })
  const labelOf = (key: string): string => params.find((param) => param.key === key)?.label || key
  const canSend =
    check?.kind === 'ready' &&
    expansion.problems.length === 0 &&
    expansion.command.trim() !== '' &&
    !isSending

  const send = async (mode: 'run' | 'insert'): Promise<void> => {
    setIsSending(true)
    const isSent = await sendSshCommand(tabId, expansion.command, mode)
    if (isSent) {
      rememberSshCommandValues(command.id, values)
      onClose()
      return
    }
    setIsSending(false)
  }

  const isRunFirst = command.runMode === 'run'
  return (
    <>
      <DialogHeader className="min-w-0">
        <DialogTitle>{command.name}</DialogTitle>
        <DialogDescription>
          {translate(
            'sshCommands.run.target',
            'Typed into this tab’s terminal, opened for {{host}}. If you connected onward from there, it runs wherever that shell is.',
            { host: target.label }
          )}
        </DialogDescription>
      </DialogHeader>
      {params.length > 0 ? (
        <div className="scrollbar-sleek flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
          {params.map((param) => (
            <ParamField
              key={param.key}
              param={param}
              value={values[param.key] ?? ''}
              onChange={(value) => setValues({ ...values, [param.key]: value })}
            />
          ))}
        </div>
      ) : null}
      <CommandList commands={[expansion.command]} />
      {check?.kind === 'blocked' ? (
        <p data-ssh-command-blocked className="text-sm text-destructive">
          {sshCommandBlockMessage(check.reason)}
        </p>
      ) : null}
      {check?.kind === 'ready' && check.doubt ? (
        <p data-ssh-command-doubt={check.doubt} className="text-sm text-destructive">
          {doubtMessage(check.doubt)}
        </p>
      ) : null}
      {expansion.problems.map((problem) => (
        <p
          key={problem.key}
          data-ssh-command-problem={problem.kind}
          className="text-sm text-destructive"
        >
          {problemMessage(problem, labelOf)}
        </p>
      ))}
      {expansion.warnings
        .filter((warning) => warning.kind === 'leadingDash')
        .map((warning) => (
          <p key={warning.key} className="text-xs text-muted-foreground">
            {translate(
              'sshCommands.run.leadingDash',
              '“{{name}}” starts with a dash, so the program may read it as an option. Quotes can’t prevent that; put -- before it in the template if it’s a name.',
              { name: labelOf(warning.key) }
            )}
          </p>
        ))}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {translate('sshCommands.run.cancel', 'Cancel')}
        </Button>
        <Button
          variant={isRunFirst ? 'outline' : 'default'}
          disabled={!canSend}
          data-ssh-command-insert
          onClick={() => void send('insert')}
        >
          {translate('sshCommands.run.insert', 'Paste without running')}
        </Button>
        <Button
          variant={isRunFirst ? 'default' : 'outline'}
          disabled={!canSend}
          data-ssh-command-run
          onClick={() => void send('run')}
        >
          {translate('sshCommands.run.run', 'Run')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Fill in the values and see the exact command. This screen is also the confirmation. */
export function SshCommandRunDialog({
  request,
  onClose
}: {
  request: SshCommandRunRequest | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent surface="security" className="sm:max-w-2xl" data-ssh-command-run-dialog>
        {request ? (
          <RunDialogBody key={request.command.id} request={request} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
