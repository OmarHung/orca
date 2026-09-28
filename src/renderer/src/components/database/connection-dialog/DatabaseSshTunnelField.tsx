import React from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { NO_SSH_TUNNEL } from './database-connection-form-state'
import { SelectField } from './database-form-controls'

// Why a sentinel option: picking it opens Add SSH host instead of becoming the saved value.
const ADD_SSH_HOST = 'add-ssh-host'

/** Picks one of Orca's saved SSH hosts to reach the server through, or none. */
export function DatabaseSshTunnelField({
  value,
  onChange,
  onAddSshHost
}: {
  value: string
  onChange: (value: string) => void
  onAddSshHost: () => void
}): React.JSX.Element {
  const labels = useAppStore((state) => state.sshTargetLabels)
  const hosts = [...labels]
    .map(([id, label]) => ({ value: id, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
  // Why keep a removed host listed: the saved value must stay visible until it's changed.
  const missing =
    value !== NO_SSH_TUNNEL && !labels.has(value)
      ? [
          {
            value,
            label: translate('database.connectionForm.sshRemoved', 'Removed SSH host'),
            disabled: true
          }
        ]
      : []
  return (
    <div className="space-y-1.5">
      <SelectField
        label={translate('database.connectionForm.sshTunnel', 'SSH tunnel')}
        value={value}
        options={[
          {
            value: NO_SSH_TUNNEL,
            label: translate('database.connectionForm.sshNone', 'None — connect directly')
          },
          ...hosts,
          ...missing,
          {
            value: ADD_SSH_HOST,
            label: translate('database.connectionForm.sshAdd', 'Add SSH host…')
          }
        ]}
        onChange={(next) => (next === ADD_SSH_HOST ? onAddSshHost() : onChange(next))}
      />
      <p className="text-[11px] text-muted-foreground">
        {value !== NO_SSH_TUNNEL
          ? translate(
              'database.connectionForm.sshHint',
              'Host and port are as seen from the SSH host, e.g. localhost or a private address.'
            )
          : hosts.length === 0
            ? translate(
                'database.connectionForm.sshEmpty',
                'No saved SSH hosts yet. Choose “Add SSH host…” to create one.'
              )
            : null}
      </p>
    </div>
  )
}
