import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { sshVpnTunnelArgs } from '../../../../shared/ssh-vpn-command-format'
import type { SshVpnContainerCandidate } from '../../../../shared/ssh-vpn-types'
import { sshVpnActions } from './ssh-vpn-store'

type Listing =
  | { state: 'loading' }
  | { state: 'ready'; containers: SshVpnContainerCandidate[] }
  | { state: 'error'; message: string }

type SshVpnContainerFieldProps = {
  value: string
  onChange: (containerName: string) => void
}

/** Picks a running VPN container (e.g. openvpn-socks) for a profile to borrow. */
export function SshVpnContainerField({
  value,
  onChange
}: SshVpnContainerFieldProps): React.JSX.Element {
  const [listing, setListing] = useState<Listing>({ state: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    setListing({ state: 'loading' })
    const result = await sshVpnActions.listContainers()
    setListing(
      'error' in result
        ? { state: 'error', message: result.error }
        : { state: 'ready', containers: result.containers }
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const containers = listing.state === 'ready' ? listing.containers : []
  // Why: a saved container that is stopped right now must still show as the current pick.
  const options =
    value && !containers.some((container) => container.name === value)
      ? [{ name: value, image: '', status: '' }, ...containers]
      : containers

  return (
    <div className="space-y-1">
      <Label htmlFor="ssh-vpn-profile-container">
        {translate('sshVpn.form.container', 'Running VPN container')}
      </Label>
      <div className="flex gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id="ssh-vpn-profile-container" size="sm" className="min-w-0 flex-1">
            <SelectValue
              placeholder={
                listing.state === 'loading'
                  ? translate('sshVpn.form.containerLoading', 'Looking for containers…')
                  : translate('sshVpn.form.containerPlaceholder', 'Choose a container')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((container) => (
              <SelectItem key={container.name} value={container.name}>
                {container.status
                  ? `${container.name} · ${container.image} · ${container.status}`
                  : container.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={() => void load()}>
          {translate('sshVpn.form.containerRefresh', 'Refresh')}
        </Button>
      </div>
      {listing.state === 'error' ? (
        <p className="text-xs break-all text-destructive">{listing.message}</p>
      ) : listing.state === 'ready' && options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.form.containerNone',
            'No running containers. Start your VPN container, then Refresh.'
          )}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {translate(
          'sshVpn.form.containerHelp',
          'Orca never starts, stops or removes this container. It needs a "tunnel" user whose traffic its firewall lets out only through the VPN; Orca checks that before every connection.'
        )}
      </p>
      {value ? (
        <p className="text-xs break-all text-muted-foreground">
          {translate('sshVpn.form.containerCommand', 'Each connection runs:')}{' '}
          <code className="font-mono text-[11px]">
            {['docker', ...sshVpnTunnelArgs(value, '<host>', '<port>')].join(' ')}
          </code>
        </p>
      ) : null}
    </div>
  )
}
