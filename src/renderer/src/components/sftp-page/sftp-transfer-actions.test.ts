// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SftpResult,
  SftpTransferOutcome,
  SftpTransferRequest
} from '../../../../shared/sftp-types'
import { startSftpTransfer } from './sftp-transfer-actions'
import { useSftpTransfersStore } from './sftp-transfers-store'

type TransferCall = (request: SftpTransferRequest) => Promise<SftpResult<SftpTransferOutcome>>

let upload: ReturnType<typeof vi.fn<TransferCall>>
let confirm: ReturnType<typeof vi.fn<(options: unknown) => Promise<boolean>>>
let onFinished: ReturnType<typeof vi.fn<(direction: string, dir: string) => void>>

const input = {
  direction: 'upload' as const,
  targetId: 'web',
  sources: ['/Users/dev/report.csv', '/Users/dev/logs'],
  destinationDir: '/srv/app'
}

beforeEach(() => {
  useSftpTransfersStore.setState({ transfers: [] })
  upload = vi.fn<TransferCall>()
  confirm = vi.fn(async () => true)
  onFinished = vi.fn()
  Reflect.set(window, 'api', { sftp: { upload, download: vi.fn(), cancel: vi.fn() } })
})

describe('startSftpTransfer', () => {
  it('records a finished transfer and refreshes the destination', async () => {
    upload.mockResolvedValue({ ok: true, value: { status: 'done' } })

    await startSftpTransfer(input, { confirm, onFinished })

    const [transfer] = useSftpTransfersStore.getState().transfers
    expect(transfer).toMatchObject({ status: 'done', label: 'report.csv and 1 more' })
    expect(upload.mock.calls[0][0]).toMatchObject({ overwrite: false, sources: input.sources })
    expect(onFinished).toHaveBeenCalledWith('upload', '/srv/app')
  })

  it('asks before replacing and retries with overwrite when the user agrees', async () => {
    upload
      .mockResolvedValueOnce({ ok: true, value: { status: 'conflict', conflicts: ['report.csv'] } })
      .mockResolvedValueOnce({ ok: true, value: { status: 'done' } })

    await startSftpTransfer(input, { confirm, onFinished })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls.map(([request]) => request.overwrite)).toEqual([false, true])
    expect(useSftpTransfersStore.getState().transfers.map((t) => t.status)).toEqual(['done'])
  })

  it('leaves everything alone when the user declines to replace', async () => {
    upload.mockResolvedValue({ ok: true, value: { status: 'conflict', conflicts: ['report.csv'] } })
    confirm.mockResolvedValue(false)

    await startSftpTransfer(input, { confirm, onFinished })

    expect(upload).toHaveBeenCalledTimes(1)
    expect(useSftpTransfersStore.getState().transfers).toEqual([])
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('keeps the error of a failed transfer', async () => {
    upload.mockResolvedValue({ ok: false, error: { message: 'Permission denied' } })

    await startSftpTransfer(input, { confirm, onFinished })

    expect(useSftpTransfersStore.getState().transfers[0]).toMatchObject({
      status: 'failed',
      error: 'Permission denied'
    })
  })
})
