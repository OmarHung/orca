import React from 'react'
import { translate } from '@/i18n/i18n'
import { useSshVpnStore, useSshVpnSync } from '../../ssh-vpn/ssh-vpn-store'
import { NO_VPN } from './database-connection-form-state'
import { SelectField } from './database-form-controls'

/** Picks one of Orca's VPN profiles (Settings → SSH) to reach the server through, or none. */
export function DatabaseVpnField({
  value,
  viaSshTunnel,
  onChange
}: {
  value: string
  /** An SSH tunnel is picked; its SSH host's own VPN setting applies instead. */
  viaSshTunnel: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  useSshVpnSync()
  const profiles = useSshVpnStore((state) => state.profiles)
  // Why keep a removed profile listed: the saved value must stay visible until it's changed.
  const missing =
    value !== NO_VPN && !profiles.some((profile) => profile.id === value)
      ? [
          {
            value,
            label: translate('database.connectionForm.vpnRemoved', 'Removed VPN profile'),
            disabled: true
          }
        ]
      : []
  const hint = viaSshTunnel
    ? translate(
        'database.connectionForm.vpnViaSsh',
        'With an SSH tunnel, the SSH host’s own VPN setting applies.'
      )
    : value !== NO_VPN
      ? translate(
          'database.connectionForm.vpnHint',
          'Host and port are as seen from inside the VPN. The rest of this computer stays off it.'
        )
      : profiles.length === 0
        ? translate(
            'database.connectionForm.vpnEmpty',
            'No VPN profiles yet. Add one in Settings → SSH.'
          )
        : null
  return (
    <div className="space-y-1.5">
      <SelectField
        label={translate('database.connectionForm.vpn', 'VPN')}
        value={viaSshTunnel ? NO_VPN : value}
        disabled={viaSshTunnel}
        options={[
          {
            value: NO_VPN,
            label: translate('database.connectionForm.sshNone', 'None — connect directly')
          },
          ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
          ...missing
        ]}
        onChange={onChange}
      />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
