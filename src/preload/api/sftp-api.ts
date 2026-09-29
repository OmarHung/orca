import type {
  SftpEntry,
  SftpExecuteOutcome,
  SftpExecuteRequest,
  SftpPlan,
  SftpPlanRequest,
  SftpResult,
  SftpTransferProgress
} from '../../shared/sftp-types'

export type SftpApi = {
  home: (targetId: string) => Promise<SftpResult<string>>
  list: (request: { targetId: string; path: string }) => Promise<SftpResult<SftpEntry[]>>
  /** Lists the exact steps an action would run; nothing changes yet. */
  plan: (request: SftpPlanRequest) => Promise<SftpResult<SftpPlan>>
  /** Runs a plan main stored earlier, once. */
  execute: (request: SftpExecuteRequest) => Promise<SftpResult<SftpExecuteOutcome>>
  discardPlan: (planId: string) => Promise<void>
  cancel: (transferId: string) => Promise<void>
  disconnect: (targetId: string) => Promise<void>
  localHome: () => Promise<string>
  localList: (path: string) => Promise<SftpResult<SftpEntry[]>>
  /** Absolute path of a file dropped from Finder; empty for virtual files. */
  getPathForFile: (file: File) => string
  onProgress: (callback: (progress: SftpTransferProgress) => void) => () => void
}
