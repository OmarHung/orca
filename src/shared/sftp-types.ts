/** A row in either pane of the SFTP page. `path` is absolute on the side it came from. */
export type SftpEntry = {
  name: string
  path: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifiedMs: number
}

export type SftpResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

export type SftpTransferDirection = 'upload' | 'download'

export type SftpTransferRequest = {
  transferId: string
  targetId: string
  /** Absolute paths on the sending side: local for uploads, remote for downloads. */
  sources: string[]
  /** Absolute directory on the receiving side. */
  destinationDir: string
  /** False reports top-level name clashes instead of replacing them. */
  overwrite: boolean
}

export type SftpTransferOutcome =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'conflict'; conflicts: string[] }

export type SftpTransferProgress = {
  transferId: string
  transferredBytes: number
  totalBytes: number
  currentFile: string | null
}
