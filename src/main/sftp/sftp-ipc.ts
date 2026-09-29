import { BrowserWindow, ipcMain } from 'electron'
import type { SftpResult, SftpTransferProgress } from '../../shared/sftp-types'
import { requestSshCredential } from '../ipc/ssh-passphrase'
import { getCurrentMainWindow } from '../ipc/ssh-ipc-context'
import { SshConnection } from '../ssh/ssh-connection'
import { getSshTargetRegistryStore } from '../ssh/ssh-target-registry'
import {
  SftpDownloadRequestSchema,
  SftpLocalPathSchema,
  SftpPathRequestSchema,
  SftpRemoveRequestSchema,
  SftpRenameRequestSchema,
  SftpTargetSchema,
  SftpUploadRequestSchema
} from './sftp-ipc-schemas'
import { listLocalDirectory, localHomeDirectory } from './sftp-local-fs'
import { SftpSessionManager } from './sftp-session-manager'

const INVALID_REQUEST: SftpResult<never> = {
  ok: false,
  error: { message: 'Invalid SFTP request' }
}

function broadcastProgress(progress: SftpTransferProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('sftp:progress', progress)
    }
  }
}

function createSftpSessionManager(): SftpSessionManager {
  return new SftpSessionManager({
    getTarget: (targetId) => getSshTargetRegistryStore()?.getTarget(targetId),
    createConnection: (target) =>
      new SshConnection(target, {
        // Why: this connection is the SFTP page's own; publishing its state would make the
        // relay's per-target status (Settings → SSH) report a connection it doesn't have.
        onStateChange: () => undefined,
        onCredentialRequest: async (targetId, kind, detail, signal) =>
          (await requestSshCredential(getCurrentMainWindow, targetId, kind, detail, signal)).value
      }),
    onProgress: broadcastProgress
  })
}

async function respond<T>(run: () => Promise<T>): Promise<SftpResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } }
  }
}

export function registerSftpHandlers(): void {
  const sessions = createSftpSessionManager()

  ipcMain.handle('sftp:home', (_event, raw: unknown) => {
    const targetId = SftpTargetSchema.safeParse(raw)
    return targetId.success ? respond(() => sessions.home(targetId.data)) : INVALID_REQUEST
  })
  ipcMain.handle('sftp:list', (_event, raw: unknown) => {
    const request = SftpPathRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.list(request.data.targetId, request.data.path))
      : INVALID_REQUEST
  })
  ipcMain.handle('sftp:mkdir', (_event, raw: unknown) => {
    const request = SftpPathRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.mkdir(request.data.targetId, request.data.path))
      : INVALID_REQUEST
  })
  ipcMain.handle('sftp:rename', (_event, raw: unknown) => {
    const request = SftpRenameRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.rename(request.data.targetId, request.data.from, request.data.to))
      : INVALID_REQUEST
  })
  ipcMain.handle('sftp:remove', (_event, raw: unknown) => {
    const request = SftpRemoveRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.remove(request.data.targetId, request.data.paths))
      : INVALID_REQUEST
  })
  ipcMain.handle('sftp:upload', (_event, raw: unknown) => {
    const request = SftpUploadRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.transfer('upload', request.data))
      : INVALID_REQUEST
  })
  ipcMain.handle('sftp:download', (_event, raw: unknown) => {
    const request = SftpDownloadRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.transfer('download', request.data))
      : INVALID_REQUEST
  })
  ipcMain.handle('sftp:cancel', (_event, raw: unknown) => {
    if (typeof raw === 'string') {
      sessions.cancel(raw)
    }
  })
  ipcMain.handle('sftp:disconnect', async (_event, raw: unknown) => {
    const targetId = SftpTargetSchema.safeParse(raw)
    if (targetId.success) {
      await sessions.disconnect(targetId.data)
    }
  })
  ipcMain.handle('sftp:localHome', () => localHomeDirectory())
  ipcMain.handle('sftp:localList', (_event, raw: unknown) => {
    const dir = SftpLocalPathSchema.safeParse(raw)
    return dir.success ? respond(() => listLocalDirectory(dir.data)) : INVALID_REQUEST
  })
}
