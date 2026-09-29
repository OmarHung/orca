import type { FileEntryWithStats, Stats, TransferOptions } from 'ssh2'

type Done = (err?: Error | null) => void

/** The SFTP calls the SFTP page makes. ssh2's SFTPWrapper satisfies it; tests use an in-memory fake. */
export type SftpOps = {
  readdir(
    path: string,
    callback: (err: Error | undefined, list: FileEntryWithStats[]) => void
  ): void
  stat(path: string, callback: (err: Error | undefined, stats: Stats) => void): void
  lstat(path: string, callback: (err: Error | undefined, stats: Stats) => void): void
  realpath(path: string, callback: (err: Error | undefined, absPath: string) => void): void
  mkdir(path: string, callback: Done): void
  rmdir(path: string, callback: Done): void
  unlink(path: string, callback: Done): void
  rename(srcPath: string, destPath: string, callback: Done): void
  fastGet(remotePath: string, localPath: string, options: TransferOptions, callback: Done): void
  fastPut(localPath: string, remotePath: string, options: TransferOptions, callback: Done): void
  end(): void
}

function settle<T>(
  run: (callback: (err: Error | null | undefined, value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, value) => (err ? reject(err) : resolve(value)))
  })
}

function settleVoid(run: (callback: Done) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    run((err) => (err ? reject(err) : resolve()))
  })
}

export const sftpReaddir = (sftp: SftpOps, path: string): Promise<FileEntryWithStats[]> =>
  settle((callback) => sftp.readdir(path, callback))

export const sftpStat = (sftp: SftpOps, path: string): Promise<Stats> =>
  settle((callback) => sftp.stat(path, callback))

export const sftpLstat = (sftp: SftpOps, path: string): Promise<Stats> =>
  settle((callback) => sftp.lstat(path, callback))

export const sftpRealpath = (sftp: SftpOps, path: string): Promise<string> =>
  settle((callback) => sftp.realpath(path, callback))

export const sftpMkdir = (sftp: SftpOps, path: string): Promise<void> =>
  settleVoid((callback) => sftp.mkdir(path, callback))

export const sftpRmdir = (sftp: SftpOps, path: string): Promise<void> =>
  settleVoid((callback) => sftp.rmdir(path, callback))

export const sftpUnlink = (sftp: SftpOps, path: string): Promise<void> =>
  settleVoid((callback) => sftp.unlink(path, callback))

export const sftpRename = (sftp: SftpOps, from: string, to: string): Promise<void> =>
  settleVoid((callback) => sftp.rename(from, to, callback))

export const sftpFastGet = (
  sftp: SftpOps,
  remotePath: string,
  localPath: string,
  onStep: (transferred: number) => void
): Promise<void> =>
  settleVoid((callback) =>
    sftp.fastGet(remotePath, localPath, { step: (total) => onStep(total) }, callback)
  )

export const sftpFastPut = (
  sftp: SftpOps,
  localPath: string,
  remotePath: string,
  onStep: (transferred: number) => void
): Promise<void> =>
  settleVoid((callback) =>
    sftp.fastPut(localPath, remotePath, { step: (total) => onStep(total) }, callback)
  )

function sftpStatusCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
}

/** ssh2 reports "already exists" (and some other failures) as SSH_FX_FAILURE, status code 4. */
export function isSftpFailureStatus(err: unknown): boolean {
  return sftpStatusCode(err) === 4
}

/** A per-request SFTP status (no such file, permission denied…), as opposed to a dead channel. */
export function isSftpStatusError(err: unknown): boolean {
  return typeof sftpStatusCode(err) === 'number'
}
