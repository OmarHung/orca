import path from 'node:path'
import type { FileEntryWithStats, Stats } from 'ssh2'
import type { SftpEntry } from '../../shared/sftp-types'
import { sftpReaddir, type SftpOps } from './sftp-ops'

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

const LS_LONG_OWNER_FIELD = 2

/** OpenSSH sends an `ls -l` line per entry; its third field is the owner name. */
export function ownerFromLongname(longname: string, uid: number): string {
  const fields = longname.trim().split(/\s+/)
  const looksLikeLsLong =
    fields.length > LS_LONG_OWNER_FIELD + 3 && /^[-dlbcps][-rwxsStT]{9}/.test(fields[0])
  return looksLikeLsLong ? fields[LS_LONG_OWNER_FIELD] : String(uid)
}

export async function listRemoteDirectory(sftp: SftpOps, dir: string): Promise<SftpEntry[]> {
  const entries = (await sftpReaddir(sftp, dir))
    .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
    .map((entry: FileEntryWithStats): SftpEntry => ({
      name: entry.filename,
      path: remotePath.join(dir, entry.filename),
      kind: entryKind(entry.attrs),
      size: entry.attrs.size,
      modifiedMs: entry.attrs.mtime * 1000,
      createdMs: null,
      owner: ownerFromLongname(entry.longname, entry.attrs.uid)
    }))
  return sortSftpEntries(entries)
}
