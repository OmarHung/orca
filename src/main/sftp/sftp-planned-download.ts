import { transferInChunks } from './sftp-chunked-transfer'
import { sftpClose, sftpFstat, sftpOpen, sftpRead, type SftpOps } from './sftp-ops'
import type { SftpLocalWriter } from './local-writer/sftp-local-writer'

/** Fills `length` bytes from `position`; servers may answer one read with fewer bytes. */
async function readChunk(
  sftp: SftpOps,
  remote: Buffer,
  position: number,
  length: number
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let filled = 0
  while (filled < length) {
    const bytesRead = await sftpRead(
      sftp,
      remote,
      buffer,
      filled,
      length - filled,
      position + filled
    )
    if (bytesRead === 0) {
      throw new Error('The remote file got shorter while it was being downloaded.')
    }
    filled += bytesRead
  }
  return buffer
}

/**
 * Downloads `remotePath` to `segments` below the confirmed folder. Bytes go through the local
 * writer, which only writes inside that folder; the file appears once it is complete.
 */
export async function downloadPlannedFile(
  sftp: SftpOps,
  remotePath: string,
  writer: SftpLocalWriter,
  segments: string[],
  onStep: (transferred: number) => void
): Promise<void> {
  const remote = await sftpOpen(sftp, remotePath, 'r')
  let handle: number | null = null
  try {
    const { size } = await sftpFstat(sftp, remote)
    handle = await writer.open(segments)
    const local = handle
    await transferInChunks(
      size,
      async (position, length) =>
        writer.write(local, position, await readChunk(sftp, remote, position, length)),
      onStep
    )
    await writer.commit(local)
    handle = null
  } finally {
    if (handle !== null) {
      await writer.abort(handle).catch(() => undefined)
    }
    await sftpClose(sftp, remote).catch(() => undefined)
  }
}
