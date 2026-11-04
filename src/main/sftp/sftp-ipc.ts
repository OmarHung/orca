import { hostname } from 'node:os'
import { BrowserWindow, ipcMain } from 'electron'
import type { SftpConnectionState, SftpResult } from '../../shared/sftp-types'
import { requestSshCredential } from '../ipc/ssh/ssh-passphrase'
import { getCurrentMainWindow } from '../ipc/ssh/ssh-ipc-context'
import { SshConnection } from '../ssh/connection/ssh-connection'
import { signInEndpoint } from '../ssh/connection/ssh-connection-manager'
import { registerSshCommandHandlers } from '../ssh-commands/ssh-commands-ipc'
import { getSshTargetRegistryStore } from '../ssh/targets/ssh-target-registry'
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
import { toSftpConnectionState } from './sftp-connection-state'
import { listLocalDirectory, localHomeDirectory } from './sftp-local-fs'
import { SftpSessionManager } from './sftp-session-manager'

const INVALID_REQUEST: SftpResult<never> = {
  ok: false,
  error: { message: INVALID_SFTP_REQUEST_MESSAGE }
}

function broadcast(channel: 'sftp:progress' | 'sftp:connectionState', payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

/** The last state of each host; a window that opens or reloads later missed the events. */
const connectionStates = new Map<string, SftpConnectionState>()

function publishConnectionState(state: SftpConnectionState): void {
  connectionStates.set(state.targetId, state)
  broadcast('sftp:connectionState', state)
}

function createSftpSessionManager(): SftpSessionManager {
  return new SftpSessionManager({
    getTarget: (targetId) => getSshTargetRegistryStore()?.getTarget(targetId),
    createConnection: (target, credentials) =>
      new SshConnection(
        target,
        {
          // Why its own channel: this connection is not the relay's, so publishing it there would
          // make the per-target status (Settings → SSH) report a connection the relay doesn't have.
          onStateChange: (_targetId, state) => publishConnectionState(toSftpConnectionState(state)),
          onCredentialRequest: async (targetId, kind, detail, signal) =>
            (await requestSshCredential(getCurrentMainWindow, targetId, kind, detail, signal)).value
        },
        credentials
      ),
    signInEndpoint,
    onProgress: (progress) => broadcast('sftp:progress', progress)
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
  // Why here: the same SSH page uses both, and upstream's registration file is over its line limit.
  registerSshCommandHandlers()
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
  ipcMain.handle('sftp:connectionStates', () => [...connectionStates.values()])
  ipcMain.handle('sftp:localHome', () => localHomeDirectory())
  ipcMain.handle('sftp:localHostname', () => hostname())
  ipcMain.handle('sftp:localList', (_event, raw: unknown) => {
    const dir = SftpLocalPathSchema.safeParse(raw)
    return dir.success ? respond(() => listLocalDirectory(dir.data)) : INVALID_REQUEST
  })
}
