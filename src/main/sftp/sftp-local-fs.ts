import { lstat, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SftpEntry } from '../../shared/sftp-types'
import { sortSftpEntries } from './sftp-remote-entries'

export function localHomeDirectory(): string {
  return os.homedir()
}

let currentUser: { uid: number; name: string } | null = null

// Why: only the signed-in user's name is cheap to know; other owners show their uid.
function ownerName(uid: number): string {
  if (currentUser === null) {
    const info = os.userInfo()
    currentUser = { uid: info.uid, name: info.username }
  }
  return uid === currentUser.uid ? currentUser.name : String(uid)
}

/** The local pane's listing. Read-only: nothing here writes to the local disk. */
export async function listLocalDirectory(dir: string): Promise<SftpEntry[]> {
  const names = await readdir(dir)
  const entries = await Promise.all(
    names.map(async (name): Promise<SftpEntry | null> => {
      const fullPath = path.join(dir, name)
      try {
        const stats = await lstat(fullPath)
        return {
          name,
          path: fullPath,
          kind: stats.isDirectory()
            ? 'directory'
            : stats.isSymbolicLink()
              ? 'symlink'
              : stats.isFile()
                ? 'file'
                : 'other',
          size: stats.size,
          modifiedMs: stats.mtimeMs,
          createdMs: stats.birthtimeMs > 0 ? stats.birthtimeMs : null,
          owner: ownerName(stats.uid)
        }
      } catch {
        // Why: an entry can vanish or be unreadable between readdir and lstat; skip it.
        return null
      }
    })
  )
  return sortSftpEntries(entries.filter((entry): entry is SftpEntry => entry !== null))
}
