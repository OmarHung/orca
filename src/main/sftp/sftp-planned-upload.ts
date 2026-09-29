import { constants, type BigIntStats } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import type { SftpLocalFileIdentity, SftpOperation } from '../../shared/sftp-types'
import { sftpClose, sftpOpenForWrite, sftpWrite, type SftpOps } from './sftp-ops'

type PutOperation = Extract<SftpOperation, { op: 'put' }>

// Why these: ssh2's fastPut defaults, so uploads keep its throughput on high-latency links.
const CHUNK_BYTES = 32 * 1024
const MAX_WRITES_IN_FLIGHT = 64

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

/** Reads each chunk from the opened file and keeps up to MAX_WRITES_IN_FLIGHT writes pending. */
async function writeChunks(
  sftp: SftpOps,
  remote: Buffer,
  local: FileHandle,
  size: number,
  onStep: (transferred: number) => void
): Promise<void> {
  let nextPosition = 0
  let transferred = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && nextPosition < size) {
      const position = nextPosition
      const length = Math.min(CHUNK_BYTES, size - position)
      nextPosition += length
      const buffer = Buffer.allocUnsafe(length)
      try {
        const { bytesRead } = await local.read(buffer, 0, length, position)
        if (bytesRead !== length) {
          throw new Error('The file got shorter while it was being uploaded.')
        }
        await sftpWrite(sftp, remote, buffer, position)
      } catch (error) {
        failed = true
        throw error
      }
      transferred += length
      onStep(transferred)
    }
  }
  const workers = Math.min(MAX_WRITES_IN_FLIGHT, Math.ceil(size / CHUNK_BYTES))
  // Why allSettled: the remote handle is closed afterwards, so no write may still be pending.
  const results = await Promise.allSettled(Array.from({ length: workers }, worker))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
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
    const remote = await sftpOpenForWrite(sftp, operation.remote)
    try {
      await writeChunks(sftp, remote, handle, size, onStep)
    } catch (error) {
      await sftpClose(sftp, remote).catch(() => undefined)
      throw error
    }
    await sftpClose(sftp, remote)
  } finally {
    await handle.close()
  }
}
