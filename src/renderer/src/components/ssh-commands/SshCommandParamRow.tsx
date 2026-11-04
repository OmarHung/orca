import { Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { SshCommandParam } from '../../../../shared/ssh-command-types'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'

function Field({
  label,
  htmlFor,
  children
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={htmlFor} variant="settings">
        {label}
      </Label>
      {children}
    </div>
  )
}

function parseOptions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** One parameter of a command: how it is asked for, and how its value enters the command. */
export function SshCommandParamRow({
  param,
  isUnused,
  onChange,
  onDelete
}: {
  param: SshCommandParam
  isUnused: boolean
  onChange: (param: SshCommandParam) => void
  onDelete: () => void
}): React.JSX.Element {
  const id = `ssh-command-edit-${param.key}`
  return (
    <div
      data-ssh-command-param-row={param.key}
      className="flex flex-col gap-2 rounded-md border border-border p-2.5"
    >
      <div className="flex items-center gap-2">
        <code className="min-w-0 truncate font-mono text-xs">{`{{${param.key}}}`}</code>
        {isUnused ? (
          <>
            <Badge variant="outline">{translate('sshCommands.edit.unused', 'Not used')}</Badge>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              aria-label={translate('sshCommands.edit.deleteParam', 'Delete parameter')}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={translate('sshCommands.edit.paramLabel', 'Label')} htmlFor={`${id}-label`}>
          <Input
            id={`${id}-label`}
            value={param.label}
            density="compact"
            onChange={(event) => onChange({ ...param, label: event.target.value })}
          />
        </Field>
        <Field label={translate('sshCommands.edit.paramKind', 'Type')} htmlFor={`${id}-kind`}>
          <Select
            value={param.kind}
            onValueChange={(kind: SshCommandParam['kind']) => onChange({ ...param, kind })}
          >
            <SelectTrigger id={`${id}-kind`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{translate('sshCommands.edit.kindText', 'Text')}</SelectItem>
              <SelectItem value="number">
                {translate('sshCommands.edit.kindNumber', 'Number')}
              </SelectItem>
              <SelectItem value="select">
                {translate('sshCommands.edit.kindSelect', 'List')}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={translate('sshCommands.edit.paramDefault', 'Default value')}
          htmlFor={`${id}-default`}
        >
          <Input
            id={`${id}-default`}
            value={param.defaultValue}
            spellCheck={false}
            variant="code"
            density="compact"
            onChange={(event) => onChange({ ...param, defaultValue: event.target.value })}
          />
        </Field>
        <Field label={translate('sshCommands.edit.paramQuote', 'Value')} htmlFor={`${id}-quote`}>
          <Select
            value={param.quote}
            onValueChange={(quote: SshCommandParam['quote']) => onChange({ ...param, quote })}
          >
            <SelectTrigger id={`${id}-quote`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shell">
                {translate('sshCommands.edit.quoteShell', 'Quote automatically')}
              </SelectItem>
              <SelectItem value="raw">
                {translate('sshCommands.edit.quoteRaw', 'Insert as written')}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {param.kind === 'select' ? (
        <Field
          label={translate('sshCommands.edit.paramOptions', 'Options, one per line')}
          htmlFor={`${id}-options`}
        >
          <Textarea
            id={`${id}-options`}
            rows={3}
            spellCheck={false}
            variant="code"
            defaultValue={(param.options ?? []).join('\n')}
            onChange={(event) => onChange({ ...param, options: parseOptions(event.target.value) })}
          />
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={param.required}
          onCheckedChange={(required) => onChange({ ...param, required })}
        />
        {translate('sshCommands.edit.paramRequired', 'Required')}
      </label>
    </div>
  )
}
