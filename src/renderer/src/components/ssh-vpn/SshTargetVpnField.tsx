import { useEffect } from 'react'
import { create } from 'zustand'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { sshVpnActions, useSshVpnStore, useSshVpnSync } from './ssh-vpn-store'

const DIRECT = 'direct'

/** The VPN picked in the host form; written only when the form saves an existing host. */
export const useSshHostVpnDraft = create<{ initial: string | null; profileId: string | null }>(
  () => ({
    initial: null,
    profileId: null
  })
)

/** Called when the host form saves; assigns the VPN picked in the form if it changed. */
export async function saveSshHostVpnDraft(targetId: string): Promise<void> {
  const { initial, profileId } = useSshHostVpnDraft.getState()
  if (profileId !== initial) {
    await sshVpnActions.setAssignment(targetId, profileId)
  }
}

/** "VPN" select in Settings → SSH's host form. */
export function SshTargetVpnField({
  open,
  targetId
}: {
  open: boolean
  /** Null while adding a host. */
  targetId: string | null
}): React.JSX.Element {
  useSshVpnSync()
  const profiles = useSshVpnStore((state) => state.profiles)
  const selected = useSshHostVpnDraft((state) => state.profileId)

  useEffect(() => {
    if (!open) {
      return
    }
    // Why getState: re-reading on every assignment change would overwrite the user's pick.
    const current = targetId ? (useSshVpnStore.getState().assignments[targetId] ?? null) : null
    useSshHostVpnDraft.setState({ initial: current, profileId: current })
  }, [open, targetId])

  return (
    <div className="space-y-1.5" data-ssh-target-vpn-field>
      <Label htmlFor="ssh-target-vpn">{translate('sshVpn.hostForm.label', 'VPN')}</Label>
      <Select
        disabled={targetId === null}
        value={selected ?? DIRECT}
        onValueChange={(value) =>
          useSshHostVpnDraft.setState({ profileId: value === DIRECT ? null : value })
        }
      >
        <SelectTrigger id="ssh-target-vpn" size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DIRECT}>
            {translate('sshVpn.menu.direct', 'Direct connection (no VPN)')}
          </SelectItem>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {translate('sshVpn.menu.profile', 'VPN: {{name}}', { name: profile.name })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {targetId === null
          ? translate(
              'sshVpn.hostForm.addFirst',
              'Save the host first, then choose its VPN here or by right-clicking it on the SSH page.'
            )
          : profiles.length === 0
            ? translate('sshVpn.hostForm.noProfiles', 'Add a VPN profile in the VPN section below.')
            : translate(
                'sshVpn.hostForm.help',
                'Connect this host through an OpenVPN profile; the rest of this computer stays off the VPN.'
              )}
      </p>
    </div>
  )
}
