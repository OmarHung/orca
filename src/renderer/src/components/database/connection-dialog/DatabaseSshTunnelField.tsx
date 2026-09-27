import React from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { NO_SSH_TUNNEL } from './database-connection-form-state'
import { SelectField } from './database-form-controls'

/** Picks one of Orca's saved SSH hosts to reach the server through, or none. */
export function DatabaseSshTunnelField({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
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
          ...missing
        ]}
        onChange={onChange}
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
                'No saved SSH hosts yet. Add one in Settings to connect through it.'
              )
            : null}
      </p>
    </div>
  )
}
