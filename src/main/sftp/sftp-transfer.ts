import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SftpTransferDirection } from '../../shared/sftp-types'
import {
  isSftpFailureStatus,
  sftpFastGet,
  sftpFastPut,
  sftpMkdir,
  sftpReaddir,
  sftpStat,
  type SftpOps
} from './sftp-ops'

export type TransferFile = { source: string; destination: string; size: number }
export type TransferPlan = { directories: string[]; files: TransferFile[]; totalBytes: number }
export type TransferProgress = { transferredBytes: number; currentFile: string | null }

const remotePath = path.posix
const PARTIAL_DOWNLOAD_SUFFIX = '.orca-download'

function emptyPlan(): TransferPlan {
  return { directories: [], files: [], totalBytes: 0 }
}

function addFile(plan: TransferPlan, file: TransferFile): void {
  plan.files.push(file)
  plan.totalBytes += file.size
}

// Why: remote names are joined onto a local folder; drop any that could climb out of it.
function isPlainName(name: string): boolean {
  return (
    name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes(path.sep)
  )
}

export async function planDownload(
  sftp: SftpOps,
  sources: readonly string[],
  localDir: string
): Promise<TransferPlan> {
  const plan = emptyPlan()
  for (const source of sources) {
    const name = remotePath.basename(source)
    if (!isPlainName(name)) {
      continue
    }
    const destination = path.join(localDir, name)
    const stats = await sftpStat(sftp, source)
    if (stats.isDirectory()) {
      await addRemoteTree(sftp, source, destination, plan)
    } else if (stats.isFile()) {
      addFile(plan, { source, destination, size: stats.size })
    }
  }
  return plan
}

async function addRemoteTree(
  sftp: SftpOps,
  dir: string,
  localDir: string,
  plan: TransferPlan
): Promise<void> {
  plan.directories.push(localDir)
  for (const entry of await sftpReaddir(sftp, dir)) {
    if (!isPlainName(entry.filename)) {
      continue
    }
    const source = remotePath.join(dir, entry.filename)
    const destination = path.join(localDir, entry.filename)
    if (entry.attrs.isDirectory()) {
      await addRemoteTree(sftp, source, destination, plan)
      continue
    }
    // Why: follow links to files, but not to folders, so a link cycle cannot recurse forever.
    const stats = entry.attrs.isSymbolicLink()
      ? await sftpStat(sftp, source).catch(() => null)
      : entry.attrs
    if (stats?.isFile()) {
      addFile(plan, { source, destination, size: stats.size })
    }
  }
}

export async function planUpload(
  sources: readonly string[],
  remoteDir: string
): Promise<TransferPlan> {
  const plan = emptyPlan()
  for (const source of sources) {
    await addLocalEntry(source, remotePath.join(remoteDir, path.basename(source)), plan)
  }
  return plan
}

async function addLocalEntry(
  source: string,
  destination: string,
  plan: TransferPlan
): Promise<void> {
  // Why: lstat, never following links, so nothing outside what the user picked gets uploaded.
  const stats = await lstat(source)
  if (stats.isDirectory()) {
    plan.directories.push(destination)
    for (const name of await readdir(source)) {
      await addLocalEntry(path.join(source, name), remotePath.join(destination, name), plan)
    }
  } else if (stats.isFile()) {
    addFile(plan, { source, destination, size: stats.size })
  }
}

/** Top-level names that already exist where the transfer would put them. */
export async function findConflicts(
  direction: SftpTransferDirection,
  sftp: SftpOps,
  sources: readonly string[],
  destinationDir: string
): Promise<string[]> {
  const conflicts: string[] = []
  for (const source of sources) {
    const name = direction === 'upload' ? path.basename(source) : remotePath.basename(source)
    const exists =
      direction === 'upload'
        ? await sftpStat(sftp, remotePath.join(destinationDir, name)).then(
            () => true,
            () => false
          )
        : await stat(path.join(destinationDir, name)).then(
            () => true,
            () => false
          )
    if (exists) {
      conflicts.push(name)
    }
  }
  return conflicts
}

async function makeDirectory(
  direction: SftpTransferDirection,
  sftp: SftpOps,
  dir: string
): Promise<void> {
  if (direction === 'download') {
    await mkdir(dir, { recursive: true })
    return
  }
  await sftpMkdir(sftp, dir).catch((err: unknown) => {
    // Why: SSH_FX_FAILURE is how OpenSSH says "exists"; merging into it is the intent.
    if (!isSftpFailureStatus(err)) {
      throw err
    }
  })
}

async function transferFile(
  direction: SftpTransferDirection,
  sftp: SftpOps,
  file: TransferFile,
  onStep: (transferred: number) => void
): Promise<void> {
  if (direction === 'upload') {
    await sftpFastPut(sftp, file.source, file.destination, onStep)
    return
  }
  // Why: download beside the target and rename on success, so a failed transfer never
  // truncates a file the user already had.
  const partial = `${file.destination}${PARTIAL_DOWNLOAD_SUFFIX}`
  try {
    await sftpFastGet(sftp, file.source, partial, onStep)
    await rename(partial, file.destination)
  } catch (err) {
    await rm(partial, { force: true })
    throw err
  }
}

export async function runTransfer(
  direction: SftpTransferDirection,
  sftp: SftpOps,
  plan: TransferPlan,
  onProgress: (progress: TransferProgress) => void
): Promise<void> {
  for (const dir of plan.directories) {
    await makeDirectory(direction, sftp, dir)
  }
  let completed = 0
  for (const file of plan.files) {
    onProgress({ transferredBytes: completed, currentFile: file.destination })
    await transferFile(direction, sftp, file, (transferred) =>
      onProgress({ transferredBytes: completed + transferred, currentFile: file.destination })
    )
    completed += file.size
  }
  onProgress({ transferredBytes: completed, currentFile: null })
}
