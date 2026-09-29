import { translate } from '@/i18n/i18n'
import { SshVpnProfilesPanel } from './SshVpnProfilesPanel'

/** The VPN profiles block in Settings → SSH; the same panel the SSH page's VPN dialog shows. */
export function SshVpnSettingsSection(): React.JSX.Element {
  return (
    <section className="space-y-3 border-t border-border/60 pt-4" data-ssh-vpn-settings>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">
          {translate('sshVpn.dialog.title', 'VPN for SSH hosts')}
        </p>
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.dialog.description',
            'Hosts you assign connect through an OpenVPN profile running in Docker, so the rest of this computer stays off the VPN.'
          )}
        </p>
      </div>
      <SshVpnProfilesPanel />
    </section>
  )
}
