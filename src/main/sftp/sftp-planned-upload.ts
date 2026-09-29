import { constants, type BigIntStats } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import type { SftpLocalFileIdentity, SftpOperation } from '../../shared/sftp-types'
import { transferInChunks } from './sftp-chunked-transfer'
import { sftpClose, sftpOpen, sftpWrite, type SftpOps } from './sftp-ops'

type PutOperation = Extract<SftpOperation, { op: 'put' }>

// Why O_NONBLOCK: a FIFO swapped in at the path would otherwise block open() forever.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)

export function localFileIdentity(stats: Pick<BigIntStats, 'dev' | 'ino'>): SftpLocalFileIdentity {
  return { dev: stats.dev.toString(), ino: stats.ino.toString() }
}

function replacedError(local: string): Error {
  return new Error(
    `"${local}" was replaced after the upload was confirmed, so it was not uploaded.`
  )
}

/**
 * Opens the file the plan listed, never a link or another file put at its path (or at a folder
 * above it) after the user confirmed. ssh2's fastPut reopens by path, so it cannot give this.
 */
async function openPlannedFile(
  operation: PutOperation
): Promise<{ handle: FileHandle; size: number }> {
  const handle = await open(operation.local, OPEN_FLAGS).catch((error: unknown) => {
    // Why: O_NOFOLLOW fails with ELOOP when the last component is now a link.
    throw error instanceof Error && 'code' in error && error.code === 'ELOOP'
      ? replacedError(operation.local)
      : error
  })
  try {
    const stats = await handle.stat({ bigint: true })
    const identity = localFileIdentity(stats)
    if (
      !stats.isFile() ||
      identity.dev !== operation.source.dev ||
      identity.ino !== operation.source.ino
    ) {
      throw replacedError(operation.local)
    }
    return { handle, size: Number(stats.size) }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Uploads a planned `put`, refusing it when the local path no longer holds the planned file. */
export async function uploadPlannedFile(
  sftp: SftpOps,
  operation: PutOperation,
  onStep: (transferred: number) => void
): Promise<void> {
  const { handle, size } = await openPlannedFile(operation)
  try {
    const remote = await sftpOpen(sftp, operation.remote, 'w')
    try {
      await transferInChunks(
        size,
        async (position, length) => {
          const buffer = Buffer.allocUnsafe(length)
          const { bytesRead } = await handle.read(buffer, 0, length, position)
          if (bytesRead !== length) {
            throw new Error('The file got shorter while it was being uploaded.')
          }
          await sftpWrite(sftp, remote, buffer, position)
        },
        onStep
      )
    } catch (error) {
      await sftpClose(sftp, remote).catch(() => undefined)
      throw error
    }
    await sftpClose(sftp, remote)
  } finally {
    await handle.close()
  }
}
