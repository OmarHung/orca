import type {
  SftpEntry,
  SftpResult,
  SftpTransferOutcome,
  SftpTransferProgress,
  SftpTransferRequest
} from '../../shared/sftp-types'

export type SftpApi = {
  home: (targetId: string) => Promise<SftpResult<string>>
  list: (request: { targetId: string; path: string }) => Promise<SftpResult<SftpEntry[]>>
  mkdir: (request: { targetId: string; path: string }) => Promise<SftpResult<void>>
  rename: (request: { targetId: string; from: string; to: string }) => Promise<SftpResult<void>>
  remove: (request: { targetId: string; paths: string[] }) => Promise<SftpResult<void>>
  upload: (request: SftpTransferRequest) => Promise<SftpResult<SftpTransferOutcome>>
  download: (request: SftpTransferRequest) => Promise<SftpResult<SftpTransferOutcome>>
  cancel: (transferId: string) => Promise<void>
  disconnect: (targetId: string) => Promise<void>
  localHome: () => Promise<string>
  localList: (path: string) => Promise<SftpResult<SftpEntry[]>>
  /** Absolute path of a file dropped from Finder; empty for virtual files. */
  getPathForFile: (file: File) => string
  onProgress: (callback: (progress: SftpTransferProgress) => void) => () => void
}
