import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSecureFile } from '../../../../../shared/secure-file'

// Why a folder per file, named with the process id: writeSecureFile restricts the parent it
// writes into, which must be a folder of ours and never the shared temp folder itself; and the
// id tells a later run which folders a crashed Orca left behind.
const FOLDER_PREFIX = 'orca-mysqldump-'
const ABANDONED_FOLDER = /^orca-mysqldump-(\d+)-/

/** A `[client]` option file carrying the password, so it never shows on a command line. */
export function mysqlOptionFileText(password: string): string {
  const escaped = password
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
  return `[client]\npassword="${escaped}"\n`
}

export type MysqlOptionFile = { path: string; remove: () => Promise<void> }

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it runs, as someone else.
    return Reflect.get(Object(error), 'code') === 'EPERM'
  }
}

/** Removes option files whose Orca process is gone (it crashed before cleaning up). */
export async function removeAbandonedMysqlOptionFiles(root: string = tmpdir()): Promise<void> {
  const entries = await readdir(root).catch(() => [])
  await Promise.all(
    entries.map(async (entry) => {
      const pid = Number(ABANDONED_FOLDER.exec(entry)?.[1])
      if (Number.isInteger(pid) && pid !== process.pid && !isRunning(pid)) {
        await rm(join(root, entry), { recursive: true, force: true }).catch(() => undefined)
      }
    })
  )
}

/**
 * Writes the password for mysqldump into a file only the current user can read: mode 0600 on
 * POSIX, a current-user-only ACL on Windows, set before the file appears under its name. If the
 * restriction doesn't take, nothing is left behind and the dump doesn't start.
 */
export async function writeMysqlOptionFile(
  password: string,
  options: { root?: string; write?: typeof writeSecureFile } = {}
): Promise<MysqlOptionFile> {
  const root = options.root ?? tmpdir()
  await removeAbandonedMysqlOptionFiles(root)
  const folder = await mkdtemp(join(root, `${FOLDER_PREFIX}${process.pid}-`))
  const remove = (): Promise<void> => rm(folder, { recursive: true, force: true })
  try {
    const path = join(folder, 'client.cnf')
    if (!(options.write ?? writeSecureFile)(path, mysqlOptionFileText(password))) {
      throw new Error(
        'Orca couldn’t limit the MySQL option file to the current user, so it didn’t pass the password to mysqldump.'
      )
    }
    return { path, remove }
  } catch (error) {
    await remove()
    throw error
  }
}
