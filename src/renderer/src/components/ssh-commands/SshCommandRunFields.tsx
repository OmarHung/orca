import { translate } from '@/i18n/i18n'
import type { SshCommandProblem } from '../../../../shared/ssh-command-template'
import type { SshCommandParam } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  sshCommandBlockMessage,
  type SshCommandDoubt,
  type SshCommandTargetCheck
} from './ssh-command-send'

export type SshCommandRunOption = { tabId: string; target: SshTarget }

// Why: Radix Select can't hold an empty value, and an optional option may be left out.
const NO_OPTION = '__none__'

export function problemMessage(
  problem: SshCommandProblem,
  labelOf: (key: string) => string
): string {
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
    case 'singleTargetOnly':
      return translate(
        'sshCommands.run.singleTargetOnly',
        'This uses one tab’s files pane, so it can’t go to several hosts. Choose one host.'
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

export function doubtMessage(doubt: SshCommandDoubt): string {
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

export function ParamField({
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

/** Other hosts in the grid can also get the command, but only if ticked. */
export function TargetPicker({
  options,
  chosenTabIds,
  checks,
  onToggle
}: {
  options: readonly SshCommandRunOption[]
  chosenTabIds: ReadonlySet<string>
  checks: Readonly<Record<string, SshCommandTargetCheck>>
  onToggle: (tabId: string, isChosen: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5" data-ssh-command-targets>
      <span className="text-xs text-muted-foreground">
        {translate('sshCommands.run.sendTo', 'Send to')}
      </span>
      <div className="scrollbar-sleek flex max-h-32 flex-col gap-1.5 overflow-y-auto">
        {options.map(({ tabId, target }) => {
          const check = checks[tabId]
          return (
            <label key={tabId} className="flex min-w-0 items-center gap-2 text-xs">
              <Checkbox
                data-ssh-command-target={tabId}
                checked={chosenTabIds.has(tabId)}
                onCheckedChange={(checked) => onToggle(tabId, checked === true)}
              />
              <span className="truncate">{target.label}</span>
              {check?.kind === 'blocked' ? (
                <span className="min-w-0 truncate text-destructive">
                  {sshCommandBlockMessage(check.reason)}
                </span>
              ) : null}
              {check?.kind === 'ready' && check.doubt ? (
                <span className="min-w-0 truncate text-destructive">
                  {check.doubt === 'manualSsh'
                    ? translate('sshCommands.run.doubtShort', 'May be on another host')
                    : translate('sshCommands.run.doubtUnverified', 'Can’t confirm it’s connected')}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
    </div>
  )
}

/** One host's command per line, so what each gets can be read before anything is sent. */
export function MultiTargetPreview({
  lines
}: {
  lines: readonly { tabId: string; host: string; command: string; isSkipped: boolean }[]
}): React.JSX.Element {
  return (
    <ul
      tabIndex={0}
      data-ssh-command-multi-preview
      className="scrollbar-sleek flex max-h-72 list-none flex-col gap-2 overflow-y-auto rounded-md border border-border bg-muted p-3 font-mono text-xs"
    >
      {lines.map((line) => (
        <li key={line.tabId} data-skipped={line.isSkipped ? 'true' : undefined}>
          <p className="truncate text-muted-foreground">
            {line.host}
            {line.isSkipped ? ` · ${translate('sshCommands.run.skipped', 'Skipped')}` : ''}
          </p>
          <p className="break-all whitespace-pre-wrap">{line.command}</p>
        </li>
      ))}
    </ul>
  )
}
