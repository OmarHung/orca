import { ipcRenderer } from 'electron'
import type { SshVpnProfileState, SshVpnStartConfirmRequest } from '../../shared/ssh-vpn-types'
import type { PreloadApi } from '../api-types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const sshVpnApi = {
  snapshot: () => ipcRenderer.invoke('sshVpn:snapshot'),
  saveProfile: (request) => ipcRenderer.invoke('sshVpn:saveProfile', request),
  deleteProfile: (profileId) => ipcRenderer.invoke('sshVpn:deleteProfile', profileId),
  setAssignment: (request) => ipcRenderer.invoke('sshVpn:setAssignment', request),
  connect: (profileId) => ipcRenderer.invoke('sshVpn:connect', profileId),
  disconnect: (profileId) => ipcRenderer.invoke('sshVpn:disconnect', profileId),
  prepareTerminal: (targetId) => ipcRenderer.invoke('sshVpn:prepareTerminal', targetId),
  pickOvpnFile: () => ipcRenderer.invoke('sshVpn:pickOvpnFile'),
  answerStart: (answer) => ipcRenderer.invoke('sshVpn:answerStart', answer),
  onState: (callback) => subscribe<SshVpnProfileState>('sshVpn:state', callback),
  onChanged: (callback) => subscribe<undefined>('sshVpn:changed', () => callback()),
  onConfirmStart: (callback) =>
    subscribe<SshVpnStartConfirmRequest>('sshVpn:confirm-start', callback)
} satisfies PreloadApi['sshVpn']
