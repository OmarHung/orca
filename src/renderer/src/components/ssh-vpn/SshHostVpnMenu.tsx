import { Badge } from '@/components/ui/badge'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { openSshVpnDialog } from './SshVpnButton'
import { SshVpnStatusDot } from './SshVpnStatusDot'
import { sshVpnActions, stateOfProfile, useSshVpnStore } from './ssh-vpn-store'

const DIRECT = 'direct'

/** The VPN a host is routed through, shown next to its name; nothing when it connects directly. */
export function SshHostVpnBadge({ targetId }: { targetId: string }): React.JSX.Element | null {
  const profile = useSshVpnStore((state) =>
    state.profiles.find((entry) => entry.id === state.assignments[targetId])
  )
  const status = useSshVpnStore((state) =>
    profile ? stateOfProfile(state.states, profile.id).status : 'stopped'
  )
  if (!profile) {
    return null
  }
  return (
    <Badge variant="hostContext" className="max-w-28" data-ssh-host-vpn={profile.id}>
      <SshVpnStatusDot status={status} />
      <span className="truncate">{profile.name}</span>
    </Badge>
  )
}

/** Right-click on a host row: pick the VPN it connects through. */
export function SshHostVpnMenu({
  targetId,
  leadingItems,
  children
}: {
  targetId: string
  /** Page-specific actions for the host, listed above the VPN choice. */
  leadingItems?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const profiles = useSshVpnStore((state) => state.profiles)
  const assigned = useSshVpnStore((state) => state.assignments[targetId] ?? DIRECT)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {leadingItems ? (
          <>
            {leadingItems}
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuLabel>{translate('sshVpn.menu.label', 'Connect through')}</ContextMenuLabel>
        <ContextMenuRadioGroup
          value={assigned}
          onValueChange={(value) =>
            void sshVpnActions.setAssignment(targetId, value === DIRECT ? null : value)
          }
        >
          <ContextMenuRadioItem value={DIRECT}>
            {translate('sshVpn.menu.direct', 'Direct connection (no VPN)')}
          </ContextMenuRadioItem>
          {profiles.map((profile) => (
            <ContextMenuRadioItem key={profile.id} value={profile.id}>
              {translate('sshVpn.menu.profile', 'VPN: {{name}}', { name: profile.name })}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={openSshVpnDialog}>
          {translate('sshVpn.menu.manage', 'Manage VPN profiles…')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
