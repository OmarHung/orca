import type { SftpLocalFileIdentity } from '../../../shared/sftp-types'

/** `segments` are single folder or file names below the confirmed download folder. */
export type LocalWriterCommand =
  | { type: 'init'; root: SftpLocalFileIdentity }
  | { type: 'mkdir'; segments: string[] }
  | { type: 'open'; segments: string[] }
  | { type: 'write'; handle: number; position: number; data: Uint8Array }
  | { type: 'commit'; handle: number }
  | { type: 'abort'; handle: number }

export type LocalWriterRequest = LocalWriterCommand & { id: number }

export type LocalWriterResponse =
  | { id: number; ok: true; handle?: number }
  | { id: number; ok: false; error: string }
