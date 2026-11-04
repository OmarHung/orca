import { useEffect } from 'react'
import { useSftpTransfersStore } from './sftp-transfers-store'

/** Feeds main-process transfer progress into the transfers panel while the SSH page is mounted. */
export function useSftpProgressEvents(): void {
  useEffect(
    () =>
      window.api.sftp.onProgress((progress) =>
        useSftpTransfersStore.getState().applyProgress(progress)
      ),
    []
  )
}
