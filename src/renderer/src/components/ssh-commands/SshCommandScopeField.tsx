import { translate } from '@/i18n/i18n'
import type { SshCommandScope } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { sshHostGroupsInTreeOrder } from '../ssh-page/ssh-host-groups'
import { useSshHostGroups } from '../ssh-page/ssh-host-groups-store'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/** Which hosts a command is offered on. Only a list of commands is narrowed; nothing runs from it. */
export function SshCommandScopeField({
  scope,
  targets,
  onChange
}: {
  scope: SshCommandScope
  targets: readonly SshTarget[]
  onChange: (scope: SshCommandScope) => void
}): React.JSX.Element {
  const groups = useSshHostGroups((state) => state.data)
  const groupOptions = sshHostGroupsInTreeOrder(groups)
  const toggleHost = (targetId: string, isChosen: boolean): void => {
    if (scope.type !== 'hosts') {
      return
    }
    const rest = scope.targetIds.filter((id) => id !== targetId)
    onChange({ type: 'hosts', targetIds: isChosen ? [...rest, targetId] : rest })
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="ssh-command-scope" variant="settings">
        {translate('sshCommands.edit.scope', 'Offer on')}
      </Label>
      <Select
        value={scope.type}
        onValueChange={(type: SshCommandScope['type']) => {
          if (type === 'all') {
            onChange({ type })
          } else if (type === 'group') {
            onChange({ type, groupId: groupOptions[0]?.group.id ?? '' })
          } else {
            onChange({ type, targetIds: [] })
          }
        }}
      >
        <SelectTrigger id="ssh-command-scope" size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {translate('sshCommands.edit.scopeAll', 'Every host')}
          </SelectItem>
          <SelectItem value="group" disabled={groupOptions.length === 0}>
            {translate('sshCommands.edit.scopeGroup', 'A group')}
          </SelectItem>
          <SelectItem value="hosts">
            {translate('sshCommands.edit.scopeHosts', 'Chosen hosts')}
          </SelectItem>
        </SelectContent>
      </Select>
      {scope.type === 'group' ? (
        <Select
          value={scope.groupId}
          onValueChange={(groupId) => onChange({ type: 'group', groupId })}
        >
          <SelectTrigger
            size="sm"
            className="w-full"
            aria-label={translate('sshCommands.edit.scopeGroup', 'A group')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groupOptions.map(({ group, label }) => (
              <SelectItem key={group.id} value={group.id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {scope.type === 'hosts' ? (
        <div className="scrollbar-sleek flex max-h-32 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
          {targets.map((target) => (
            <label key={target.id} className="flex min-w-0 items-center gap-2 text-xs">
              <Checkbox
                checked={scope.targetIds.includes(target.id)}
                onCheckedChange={(checked) => toggleHost(target.id, checked === true)}
              />
              <span className="truncate">{target.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}
