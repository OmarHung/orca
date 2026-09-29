import path from 'node:path'
import type { FileEntryWithStats, Stats } from 'ssh2'
import type { SftpEntry } from '../../shared/sftp-types'
import { sftpLstat, sftpReaddir, sftpRmdir, sftpUnlink, type SftpOps } from './sftp-ops'

const remotePath = path.posix

function entryKind(stats: Stats): SftpEntry['kind'] {
  if (stats.isDirectory()) {
    return 'directory'
  }
  if (stats.isSymbolicLink()) {
    return 'symlink'
  }
  return stats.isFile() ? 'file' : 'other'
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then by name, as file managers list them. */
export function sortSftpEntries(entries: SftpEntry[]): SftpEntry[] {
  return entries.sort(
    (a, b) =>
      Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
      NAME_COLLATOR.compare(a.name, b.name)
  )
}

export async function listRemoteDirectory(sftp: SftpOps, dir: string): Promise<SftpEntry[]> {
  const entries = (await sftpReaddir(sftp, dir))
    .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
    .map((entry: FileEntryWithStats): SftpEntry => ({
      name: entry.filename,
      path: remotePath.join(dir, entry.filename),
      kind: entryKind(entry.attrs),
      size: entry.attrs.size,
      modifiedMs: entry.attrs.mtime * 1000
    }))
  return sortSftpEntries(entries)
}

/** Deletes a file, link or folder tree. Links are removed, never followed into. */
export async function removeRemotePath(sftp: SftpOps, target: string): Promise<void> {
  const stats = await sftpLstat(sftp, target)
  if (!stats.isDirectory()) {
    await sftpUnlink(sftp, target)
    return
  }
  for (const entry of await sftpReaddir(sftp, target)) {
    if (entry.filename !== '.' && entry.filename !== '..') {
      await removeRemotePath(sftp, remotePath.join(target, entry.filename))
    }
  }
  await sftpRmdir(sftp, target)
}
