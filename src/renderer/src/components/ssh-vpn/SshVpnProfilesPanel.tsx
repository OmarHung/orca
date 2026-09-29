import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { SshVpnProfileForm } from './SshVpnProfileForm'
import { SshVpnProfileRow } from './SshVpnProfileRow'
import { stateOfProfile, useSshVpnStore, useSshVpnSync } from './ssh-vpn-store'

type Editing = { mode: 'new' } | { mode: 'edit'; profileId: string } | null

/** VPN profiles with status, connect/disconnect and editing; used by the SSH page and Settings. */
export function SshVpnProfilesPanel(): React.JSX.Element {
  useSshVpnSync()
  const profiles = useSshVpnStore((state) => state.profiles)
  const states = useSshVpnStore((state) => state.states)
  const assignments = useSshVpnStore((state) => state.assignments)
  const loadError = useSshVpnStore((state) => state.loadError)
  const [editing, setEditing] = useState<Editing>(null)
  const hostCounts = new Map<string, number>()
  for (const profileId of Object.values(assignments)) {
    hostCounts.set(profileId, (hostCounts.get(profileId) ?? 0) + 1)
  }

  return (
    <div className="space-y-3" data-ssh-vpn-panel>
      {loadError ? <p className="text-sm break-all text-destructive">{loadError}</p> : null}
      {editing?.mode === 'new' ? (
        <SshVpnProfileForm profile={null} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setEditing({ mode: 'new' })}>
          <Plus className="size-3.5" />
          {translate('sshVpn.panel.add', 'Add VPN profile')}
        </Button>
      )}
      {profiles.length === 0 && editing?.mode !== 'new' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.panel.empty',
            'No VPN profiles yet. Add an .ovpn file, then right-click a host to route it through the VPN.'
          )}
        </p>
      ) : null}
      <ul className="space-y-2">
        {profiles.map((profile) =>
          editing?.mode === 'edit' && editing.profileId === profile.id ? (
            <li key={profile.id}>
              <SshVpnProfileForm profile={profile} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <SshVpnProfileRow
              key={profile.id}
              profile={profile}
              state={stateOfProfile(states, profile.id)}
              hostCount={hostCounts.get(profile.id) ?? 0}
              onEdit={() => setEditing({ mode: 'edit', profileId: profile.id })}
            />
          )
        )}
      </ul>
    </div>
  )
}
