import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  isAbsoluteOvpnPath,
  sshVpnAssignmentSchema,
  sshVpnConfirmAnswerSchema,
  sshVpnCredentialAnswerSchema,
  sshVpnProfileIdSchema,
  sshVpnSaveProfileSchema,
  type SshVpnOvpnInspection,
  type SshVpnResult,
  type SshVpnSnapshot
} from '../../shared/ssh-vpn-types'
import { getSecretStore } from '../../shared/secret-store'
import { getCurrentMainWindow } from '../ipc/ssh-ipc-context'
import { resolveWithSshG } from '../ssh/ssh-config-parser'
import { getSshTargetRegistryStore } from '../ssh/ssh-target-registry'
import { readOvpnProfileFile } from './ovpn-profile-files'
import { prepareOvpnProfile } from './ovpn-profile-preparation'
import { SshVpnStartDeclinedError } from './ssh-vpn-manager-types'
import { saveSshVpnProfile } from './ssh-vpn-profile-save'
import { createSshVpnRuntime, type SshVpnRuntime } from './ssh-vpn-runtime'

const INVALID_REQUEST = { ok: false, error: { message: 'Invalid VPN request' } } as const

function broadcast(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function sendToMainWindow(channel: string, payload: unknown): boolean {
  const window = getCurrentMainWindow()
  if (!window || window.isDestroyed()) {
    return false
  }
  window.webContents.send(channel, payload)
  return true
}

async function respond<T>(run: () => Promise<T> | T): Promise<SshVpnResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return err instanceof SshVpnStartDeclinedError
      ? { ok: false, error: { message, declined: true } }
      : { ok: false, error: { message } }
  }
}

function snapshot(runtime: SshVpnRuntime): SshVpnSnapshot {
  const registry = getSshTargetRegistryStore()
  // Why here: hosts are removed through upstream code; dropping their assignments whenever the
  // VPN UI loads keeps host counts right without hooking removal. A new host gets a new id.
  if (registry) {
    runtime.store.pruneAssignments(new Set(registry.listTargets().map((target) => target.id)))
  }
  return {
    profiles: runtime.store.listProfiles(),
    assignments: runtime.store.listAssignments(),
    states: runtime.manager.listStates(),
    savedPasswordProfileIds: runtime.vault.savedProfileIds(),
    canStorePasswords: runtime.vault.canStorePasswords()
  }
}

async function inspectOvpn(ovpnPath: string): Promise<SshVpnOvpnInspection> {
  const prepared = await prepareOvpnProfile(ovpnPath, readOvpnProfileFile)
  return { needsCredentials: prepared.needsCredentials }
}

function registerProfileHandlers(runtime: SshVpnRuntime): void {
  const { store, manager, vault } = runtime
  ipcMain.handle('sshVpn:snapshot', () => respond(() => snapshot(runtime)))
  ipcMain.handle('sshVpn:inspectOvpn', (_event, raw: unknown) =>
    typeof raw === 'string' && isAbsoluteOvpnPath(raw)
      ? respond(() => inspectOvpn(raw))
      : INVALID_REQUEST
  )
  ipcMain.handle('sshVpn:saveProfile', (_event, raw: unknown) => {
    const request = sshVpnSaveProfileSchema.safeParse(raw)
    if (!request.success) {
      return INVALID_REQUEST
    }
    return respond(async () => {
      const { previous, saved } = await saveSshVpnProfile(
        { store, vault, inspectOvpn },
        request.data
      )
      if (previous && previous.ovpnPath !== saved.ovpnPath) {
        await manager.stop(saved.id)
      }
      manager.updateProfile(saved)
      broadcast('sshVpn:changed')
      return saved
    })
  })
  ipcMain.handle('sshVpn:deleteProfile', (_event, raw: unknown) => {
    const id = sshVpnProfileIdSchema.safeParse(raw)
    if (!id.success) {
      return INVALID_REQUEST
    }
    return respond(async () => {
      await manager.stop(id.data)
      // Why first: a profile deleted before its password would leave that password with nothing to remove it from.
      vault.forget(id.data)
      store.deleteProfile(id.data)
      broadcast('sshVpn:changed')
    })
  })
  ipcMain.handle('sshVpn:setAssignment', (_event, raw: unknown) => {
    const request = sshVpnAssignmentSchema.safeParse(raw)
    if (!request.success) {
      return INVALID_REQUEST
    }
    return respond(() => {
      const { targetId, profileId } = request.data
      if (profileId && !store.getProfile(profileId)) {
        throw new Error('This VPN profile no longer exists')
      }
      store.setAssignment(targetId, profileId)
      broadcast('sshVpn:changed')
    })
  })
  ipcMain.handle('sshVpn:pickOvpnFile', async () => {
    const window = getCurrentMainWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'OpenVPN', extensions: ['ovpn', 'conf'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

function registerConnectionHandlers(runtime: SshVpnRuntime): void {
  const { manager, service, approvals, logins } = runtime
  ipcMain.handle('sshVpn:connect', (_event, raw: unknown) => {
    const id = sshVpnProfileIdSchema.safeParse(raw)
    return id.success ? respond(() => service.connect(id.data)) : INVALID_REQUEST
  })
  ipcMain.handle('sshVpn:disconnect', (_event, raw: unknown) => {
    const id = sshVpnProfileIdSchema.safeParse(raw)
    return id.success ? respond(() => manager.stop(id.data)) : INVALID_REQUEST
  })
  ipcMain.handle('sshVpn:prepareTerminal', (_event, raw: unknown) => {
    if (typeof raw !== 'string' || raw.length === 0) {
      return INVALID_REQUEST
    }
    return respond(async () => {
      const target = getSshTargetRegistryStore()?.getTarget(raw)
      if (!target) {
        throw new Error('SSH host not found')
      }
      const resolved = await resolveWithSshG(target.configHost || target.label).catch(() => null)
      return service.prepareTerminal(target, resolved)
    })
  })
  ipcMain.handle('sshVpn:answerStart', (_event, raw: unknown) => {
    const answer = sshVpnConfirmAnswerSchema.safeParse(raw)
    if (answer.success) {
      approvals.answer(answer.data.requestId, answer.data.approved)
    }
  })
  ipcMain.handle('sshVpn:answerCredentials', (_event, raw: unknown) => {
    const answer = sshVpnCredentialAnswerSchema.safeParse(raw)
    if (answer.success) {
      logins.answer(answer.data.requestId, answer.data.credentials)
    }
  })
}

export function registerSshVpnHandlers(): void {
  const runtime = createSshVpnRuntime({
    userDataPath: app.getPath('userData'),
    secretStore: getSecretStore,
    onStateChange: (state) => broadcast('sshVpn:state', state),
    onProfilesChanged: () => broadcast('sshVpn:changed'),
    sendStartConfirm: (request) => sendToMainWindow('sshVpn:confirm-start', request),
    sendCredentialRequest: (request) => sendToMainWindow('sshVpn:credential-request', request)
  })
  registerProfileHandlers(runtime)
  registerConnectionHandlers(runtime)
  app.on('will-quit', runtime.removeAllSync)
}
