import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { SshVpnProfileState, SshVpnStatus } from '../../../../shared/ssh-vpn-types'
import { SshVpnProfilesPanel } from './SshVpnProfilesPanel'
import { SshVpnStatusDot } from './SshVpnStatusDot'
import { useSshVpnStore, useSshVpnSync } from './ssh-vpn-store'

/** Lets a host row's context menu open the same dialog as the button. */
export const useSshVpnDialog = create<{ isOpen: boolean }>(() => ({ isOpen: false }))

export function openSshVpnDialog(): void {
  useSshVpnDialog.setState({ isOpen: true })
}

/** The most urgent status across all VPNs, for the one dot on the button. */
function overallStatus(states: readonly SshVpnProfileState[]): SshVpnStatus {
  const statuses = new Set(states.map((state) => state.status))
  if (statuses.has('error')) {
    return 'error'
  }
  if (statuses.has('starting') || statuses.has('stopping')) {
    return 'starting'
  }
  return statuses.has('ready') ? 'ready' : 'stopped'
}

/** "VPN" button in the host column; opens the VPN profiles dialog. */
export function SshVpnButton(): React.JSX.Element {
  useSshVpnSync()
  const hasProfiles = useSshVpnStore((state) => state.profiles.length > 0)
  const states = useSshVpnStore((state) => state.states)
  const isOpen = useSshVpnDialog((state) => state.isOpen)

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0"
        data-ssh-vpn-button
        onClick={openSshVpnDialog}
      >
        {hasProfiles ? <SshVpnStatusDot status={overallStatus(Object.values(states))} /> : null}
        {translate('sshVpn.button', 'VPN')}
      </Button>
      <Dialog open={isOpen} onOpenChange={(open) => useSshVpnDialog.setState({ isOpen: open })}>
        <DialogContent className="sm:max-w-2xl" data-ssh-vpn-dialog>
          <DialogHeader>
            <DialogTitle>{translate('sshVpn.dialog.title', 'VPN for SSH hosts')}</DialogTitle>
            <DialogDescription>
              {translate(
                'sshVpn.dialog.description',
                'Hosts you assign connect through an OpenVPN profile running in Docker, so the rest of this computer stays off the VPN.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
            <SshVpnProfilesPanel />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
