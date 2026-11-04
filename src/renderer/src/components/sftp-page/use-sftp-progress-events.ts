import { useEffect } from 'react'
import { useSftpConnectionStore } from './sftp-connection-store'
import { useSftpTransfersStore } from './sftp-transfers-store'

/** Feeds transfer progress and connection states from main while the SSH page is mounted. */
export function useSftpProgressEvents(): void {
  useEffect(
    () =>
      window.api.sftp.onProgress((progress) =>
        useSftpTransfersStore.getState().applyProgress(progress)
      ),
    []
  )
  useEffect(() => {
    const unsubscribe = window.api.sftp.onConnectionState((state) =>
      useSftpConnectionStore.getState().apply(state)
    )
    // Why tolerate: the web client's fallback API resolves to nothing, and this is only a head start.
    void window.api.sftp
      .connectionStates()
      .then((states) => useSftpConnectionStore.getState().applySnapshot(states ?? []))
      .catch(() => undefined)
    return unsubscribe
  }, [])
}
