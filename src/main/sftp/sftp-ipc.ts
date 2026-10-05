import { BrowserWindow, ipcMain } from 'electron'
import type { SftpResult, SftpTransferProgress } from '../../shared/sftp-types'
import { requestSshCredential } from '../ipc/ssh-passphrase'
import { getCurrentMainWindow } from '../ipc/ssh-ipc-context'
import { SshConnection } from '../ssh/ssh-connection'
import { getSshTargetRegistryStore } from '../ssh/ssh-target-registry'
import {
  INVALID_SFTP_REQUEST_MESSAGE,
  SftpExecuteRequestSchema,
  SftpLocalPathSchema,
  SftpPathRequestSchema,
  SftpPlanIdSchema,
  SftpPlanRequestSchema,
  SftpTargetSchema,
  sftpPlanRequestRejection
} from './sftp-ipc-schemas'
import { listLocalDirectory, localHomeDirectory } from './sftp-local-fs'
import { SftpSessionManager } from './sftp-session-manager'

const INVALID_REQUEST: SftpResult<never> = {
  ok: false,
  error: { message: INVALID_SFTP_REQUEST_MESSAGE }
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
  // Why: changes only run as plan → user confirms the listed steps → execute that stored plan.
  ipcMain.handle('sftp:plan', (_event, raw: unknown) => {
    const request = SftpPlanRequestSchema.safeParse(raw)
    return request.success
      ? respond(() => sessions.plan(request.data))
      : { ok: false, error: { message: sftpPlanRequestRejection(request.error) } }
  })
  ipcMain.handle('sftp:execute', (_event, raw: unknown) => {
    const request = SftpExecuteRequestSchema.safeParse(raw)
    return request.success ? respond(() => sessions.execute(request.data)) : INVALID_REQUEST
  })
  ipcMain.handle('sftp:discardPlan', (_event, raw: unknown) => {
    const planId = SftpPlanIdSchema.safeParse(raw)
    if (planId.success) {
      sessions.discardPlan(planId.data)
    }
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
