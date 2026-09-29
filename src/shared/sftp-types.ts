/** A row in either pane of the SFTP page. `path` is absolute on the side it came from. */
export type SftpEntry = {
  name: string
  path: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifiedMs: number
  /** Null for remote entries: SFTP v3 (OpenSSH) does not report a creation time. */
  createdMs: number | null
  /** User name when known, else the numeric uid. */
  owner: string | null
}

export type SftpResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

export type SftpTransferDirection = 'upload' | 'download'

/**
 * One step the app will run, in order. Plans are built and stored by main; the renderer only
 * displays them, and main executes the stored copy, so what is shown is exactly what runs.
 */
export type SftpOperation =
  /** Remote mkdir; `keepExisting` merges into a folder that is already there. */
  | { op: 'mkdir'; path: string; keepExisting: boolean }
  /** Local mkdir that keeps an existing folder. */
  | { op: 'lmkdir'; path: string }
  | { op: 'put'; local: string; remote: string; size: number }
  /** Written to `<local>.orca-download`, then renamed over `local` once complete. */
  | { op: 'get'; remote: string; local: string; size: number }
  | { op: 'rename'; from: string; to: string }
  | { op: 'rm'; path: string }
  | { op: 'rmdir'; path: string }

export type SftpPlanKind = 'upload' | 'download' | 'mkdir' | 'rename' | 'move' | 'remove'

export type SftpPlanRequest =
  | { kind: 'upload'; targetId: string; sources: string[]; destinationDir: string }
  | { kind: 'download'; targetId: string; sources: string[]; destinationDir: string }
  | { kind: 'mkdir'; targetId: string; path: string }
  | { kind: 'rename'; targetId: string; from: string; to: string }
  | { kind: 'move'; targetId: string; sources: string[]; destinationDir: string }
  | { kind: 'remove'; targetId: string; paths: string[] }

export type SftpPlan = {
  planId: string
  kind: SftpPlanKind
  targetId: string
  operations: SftpOperation[]
  totalBytes: number
  /** Top-level names that already exist where a transfer, rename or move would put them. */
  conflicts: string[]
}

export type SftpExecuteRequest = {
  planId: string
  /** Progress and cancel handle; only transfers report progress. */
  transferId: string
}

export type SftpExecuteOutcome = { status: 'done' } | { status: 'cancelled' }

export type SftpTransferProgress = {
  transferId: string
  transferredBytes: number
  totalBytes: number
  currentFile: string | null
}
