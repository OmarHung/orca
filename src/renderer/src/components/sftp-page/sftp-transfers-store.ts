import { create } from 'zustand'
import type { SftpTransferDirection, SftpTransferProgress } from '../../../../shared/sftp-types'

export type SftpTransferStatus = 'running' | 'done' | 'failed' | 'cancelled'

export type SftpTransfer = {
  id: string
  direction: SftpTransferDirection
  targetId: string
  label: string
  destinationDir: string
  status: SftpTransferStatus
  transferredBytes: number
  totalBytes: number
  currentFile: string | null
  error: string | null
}

type SftpTransferStart = Pick<
  SftpTransfer,
  'id' | 'direction' | 'targetId' | 'label' | 'destinationDir'
>

type SftpTransfersState = {
  transfers: SftpTransfer[]
  begin: (transfer: SftpTransferStart) => void
  applyProgress: (progress: SftpTransferProgress) => void
  finish: (id: string, status: Exclude<SftpTransferStatus, 'running'>, error?: string) => void
  discard: (id: string) => void
  clearFinished: () => void
}

function updateTransfer(
  transfers: SftpTransfer[],
  id: string,
  update: (transfer: SftpTransfer) => SftpTransfer
): SftpTransfer[] {
  return transfers.map((transfer) => (transfer.id === id ? update(transfer) : transfer))
}

/** Transfers of the SFTP page, newest first; fork-local so it stays out of upstream's store. */
export const useSftpTransfersStore = create<SftpTransfersState>((set) => ({
  transfers: [],
  begin: (start) =>
    set((state) => ({
      transfers: [
        {
          ...start,
          status: 'running',
          transferredBytes: 0,
          totalBytes: 0,
          currentFile: null,
          error: null
        },
        ...state.transfers
      ]
    })),
  applyProgress: (progress) =>
    set((state) => ({
      transfers: updateTransfer(state.transfers, progress.transferId, (transfer) =>
        transfer.status === 'running'
          ? {
              ...transfer,
              transferredBytes: progress.transferredBytes,
              totalBytes: progress.totalBytes,
              currentFile: progress.currentFile
            }
          : transfer
      )
    })),
  finish: (id, status, error) =>
    set((state) => ({
      transfers: updateTransfer(state.transfers, id, (transfer) => ({
        ...transfer,
        status,
        error: error ?? null,
        currentFile: null,
        transferredBytes: status === 'done' ? transfer.totalBytes : transfer.transferredBytes
      }))
    })),
  discard: (id) =>
    set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.id !== id) })),
  clearFinished: () =>
    set((state) => ({
      transfers: state.transfers.filter((transfer) => transfer.status === 'running')
    }))
}))
