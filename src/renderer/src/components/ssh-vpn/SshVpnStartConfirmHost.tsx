import { useEffect } from 'react'
import { translate } from '@/i18n/i18n'
import type { SshVpnStartConfirmRequest } from '../../../../shared/ssh-vpn-types'
import { useCommandConfirm } from '../command-confirm/command-confirm-context'
import { CommandConfirmProvider } from '../command-confirm/CommandConfirmProvider'

function describeRequest(request: SshVpnStartConfirmRequest): string[] {
  return [
    request.hostLabel
      ? translate('sshVpn.confirm.forHost', 'Connecting to {{host}} needs this VPN.', {
          host: request.hostLabel
        })
      : translate('sshVpn.confirm.manual', 'You asked to connect this VPN.'),
    translate(
      'sshVpn.confirm.isolated',
      'It runs in a Docker container; the rest of this computer stays off the VPN.'
    )
  ]
}

function StartConfirmListener(): null {
  const confirm = useCommandConfirm()
  useEffect(() => {
    if (!window.api?.sshVpn) {
      return
    }
    return window.api.sshVpn.onConfirmStart(async (request) => {
      const approved = await confirm({
        title: translate('sshVpn.confirm.title', 'Start VPN "{{name}}"?', {
          name: request.profileName
        }),
        details: describeRequest(request),
        commands: request.commands,
        notes: [
          translate(
            'sshVpn.confirm.tunnelNote',
            'Each SSH connection then runs `docker exec -i <container> nc -w 30 <host> <port>` to reach the host through the VPN.'
          )
        ],
        confirmLabel: translate('sshVpn.confirm.start', 'Start VPN')
      })
      await window.api.sshVpn.answerStart({ requestId: request.requestId, approved })
    })
  }, [confirm])
  return null
}

/** Mounted once at the app root: main asks here before any VPN starts, whichever page needs it. */
export function SshVpnStartConfirmHost(): React.JSX.Element {
  return (
    <CommandConfirmProvider>
      <StartConfirmListener />
    </CommandConfirmProvider>
  )
}
