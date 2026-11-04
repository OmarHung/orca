import { ipcRenderer, webUtils } from 'electron'
import type { SftpConnectionState, SftpTransferProgress } from '../../shared/sftp-types'
import type { PreloadApi } from '../api-types'

export const sftpApi = {
  home: (targetId) => ipcRenderer.invoke('sftp:home', targetId),
  list: (request) => ipcRenderer.invoke('sftp:list', request),
  plan: (request) => ipcRenderer.invoke('sftp:plan', request),
  execute: (request) => ipcRenderer.invoke('sftp:execute', request),
  discardPlan: (planId) => ipcRenderer.invoke('sftp:discardPlan', planId),
  cancel: (transferId) => ipcRenderer.invoke('sftp:cancel', transferId),
  disconnect: (targetId) => ipcRenderer.invoke('sftp:disconnect', targetId),
  connectionStates: () => ipcRenderer.invoke('sftp:connectionStates'),
  localHome: () => ipcRenderer.invoke('sftp:localHome'),
  localHostname: () => ipcRenderer.invoke('sftp:localHostname'),
  localList: (path) => ipcRenderer.invoke('sftp:localList', path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SftpTransferProgress) =>
      callback(progress)
    ipcRenderer.on('sftp:progress', listener)
    return () => ipcRenderer.removeListener('sftp:progress', listener)
  },
  onConnectionState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SftpConnectionState) =>
      callback(state)
    ipcRenderer.on('sftp:connectionState', listener)
    return () => ipcRenderer.removeListener('sftp:connectionState', listener)
  }
} satisfies PreloadApi['sftp']
