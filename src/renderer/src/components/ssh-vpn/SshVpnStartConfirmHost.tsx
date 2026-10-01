import { useEffect, useState } from 'react'
import type { SshVpnStartConfirmRequest } from '../../../../shared/ssh-vpn-types'
import { SshVpnLoginPromptHost } from './SshVpnLoginPromptHost'
import { SshVpnStartConfirmDialog } from './SshVpnStartConfirmDialog'

/**
 * Mounted once at the app root: main asks here before any VPN starts, and for its login when one
 * is needed, whichever page needs it.
 */
export function SshVpnStartConfirmHost(): React.JSX.Element {
  const [queue, setQueue] = useState<SshVpnStartConfirmRequest[]>([])

  useEffect(() => {
    if (!window.api?.sshVpn) {
      return
    }
    return window.api.sshVpn.onConfirmStart((request) =>
      setQueue((current) => [...current, request])
    )
  }, [])

  const current = queue[0]
  return (
    <>
      {current ? (
        <SshVpnStartConfirmDialog
          key={current.requestId}
          request={current}
          onDone={() => setQueue((pending) => pending.slice(1))}
        />
      ) : null}
      <SshVpnLoginPromptHost />
    </>
  )
}
