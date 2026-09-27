import { ipcRenderer } from 'electron'
import type { DatabaseSessionEvent } from '../../shared/database/database-session-types'
import type { PreloadApi } from '../api-types'

export const databaseApi = {
  listConnections: () => ipcRenderer.invoke('database:listConnections'),
  encryptionStatus: () => ipcRenderer.invoke('database:encryptionStatus'),
  saveConnection: (request) => ipcRenderer.invoke('database:saveConnection', request),
  deleteConnection: (connectionId) => ipcRenderer.invoke('database:deleteConnection', connectionId),
  testConnection: (request) => ipcRenderer.invoke('database:testConnection', request),
  connect: (connectionId, password) =>
    ipcRenderer.invoke('database:connect', connectionId, password),
  disconnect: (connectionId) => ipcRenderer.invoke('database:disconnect', connectionId),
  introspect: (connectionId, target) =>
    ipcRenderer.invoke('database:introspect', connectionId, target),
  execute: (request) => ipcRenderer.invoke('database:execute', request),
  fetchMore: (request) => ipcRenderer.invoke('database:fetchMore', request),
  cancel: (ref) => ipcRenderer.invoke('database:cancel', ref),
  closeConsole: (ref) => ipcRenderer.invoke('database:closeConsole', ref),
  readConsole: (ref) => ipcRenderer.invoke('database:readConsole', ref),
  writeConsole: (ref, text) => ipcRenderer.invoke('database:writeConsole', ref, text),
  pickSqliteFile: () => ipcRenderer.invoke('database:pickSqliteFile'),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DatabaseSessionEvent) =>
      callback(event)
    ipcRenderer.on('database:event', listener)
    return () => ipcRenderer.removeListener('database:event', listener)
  }
} satisfies PreloadApi['database']
