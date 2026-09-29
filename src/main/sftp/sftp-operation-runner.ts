import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import type { SftpOperation } from '../../shared/sftp-types'
import {
  isSftpFailureStatus,
  sftpFastGet,
  sftpFastPut,
  sftpMkdir,
  sftpRename,
  sftpRmdir,
  sftpStat,
  sftpUnlink,
  type SftpOps
} from './sftp-ops'

export type OperationProgress = { transferredBytes: number; currentFile: string | null }

const PARTIAL_DOWNLOAD_SUFFIX = '.orca-download'

async function remoteMkdir(sftp: SftpOps, dir: string, keepExisting: boolean): Promise<void> {
  try {
    await sftpMkdir(sftp, dir)
  } catch (err) {
    // Why: SSH_FX_FAILURE is how OpenSSH says "exists"; only a folder may be merged into.
    const isFolder =
      keepExisting && isSftpFailureStatus(err)
        ? await sftpStat(sftp, dir).then(
            (stats) => stats.isDirectory(),
            () => false
          )
        : false
    if (!isFolder) {
      throw err
    }
  }
}

async function localMkdir(dir: string): Promise<void> {
  try {
    await mkdir(dir)
  } catch (err) {
    const isFolder = await lstat(dir).then(
      (stats) => stats.isDirectory(),
      () => false
    )
    if (!isFolder) {
      throw err
    }
  }
}

// Why: download beside the target and rename on success, so a failed transfer never
// truncates a file the user already had.
async function download(
  sftp: SftpOps,
  remote: string,
  local: string,
  onStep: (transferred: number) => void
): Promise<void> {
  const partial = `${local}${PARTIAL_DOWNLOAD_SUFFIX}`
  try {
    await sftpFastGet(sftp, remote, partial, onStep)
    await rename(partial, local)
  } catch (err) {
    await rm(partial, { force: true })
    throw err
  }
}

/** Runs a confirmed plan exactly as listed, stopping at the first failure. */
export async function runSftpOperations(
  sftp: SftpOps,
  operations: readonly SftpOperation[],
  onProgress: (progress: OperationProgress) => void
): Promise<void> {
  let completed = 0
  for (const operation of operations) {
    switch (operation.op) {
      case 'mkdir':
        await remoteMkdir(sftp, operation.path, operation.keepExisting)
        break
      case 'lmkdir':
        await localMkdir(operation.path)
        break
      case 'put':
      case 'get': {
        const current = operation.op === 'put' ? operation.remote : operation.local
        const onStep = (transferred: number): void =>
          onProgress({ transferredBytes: completed + transferred, currentFile: current })
        onProgress({ transferredBytes: completed, currentFile: current })
        await (operation.op === 'put'
          ? sftpFastPut(sftp, operation.local, operation.remote, onStep)
          : download(sftp, operation.remote, operation.local, onStep))
        completed += operation.size
        break
      }
      case 'rename':
        await sftpRename(sftp, operation.from, operation.to)
        break
      case 'rm':
        await sftpUnlink(sftp, operation.path)
        break
      case 'rmdir':
        await sftpRmdir(sftp, operation.path)
        break
    }
  }
  onProgress({ transferredBytes: completed, currentFile: null })
}
