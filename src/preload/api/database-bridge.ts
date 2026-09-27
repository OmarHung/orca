import { ipcRenderer } from 'electron'
import type { DatabasePageEvent } from '../../shared/database/database-session-types'
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
  ddl: (connectionId, target) => ipcRenderer.invoke('database:ddl', connectionId, target),
  execute: (request) => ipcRenderer.invoke('database:execute', request),
  fetchMore: (request) => ipcRenderer.invoke('database:fetchMore', request),
  listHistory: (connectionId) => ipcRenderer.invoke('database:listHistory', connectionId),
  clearHistory: (connectionId) => ipcRenderer.invoke('database:clearHistory', connectionId),
  cancel: (ref) => ipcRenderer.invoke('database:cancel', ref),
  closeConsole: (ref) => ipcRenderer.invoke('database:closeConsole', ref),
  readConsole: (ref) => ipcRenderer.invoke('database:readConsole', ref),
  writeConsole: (ref, text) => ipcRenderer.invoke('database:writeConsole', ref, text),
  pickSqliteFile: () => ipcRenderer.invoke('database:pickSqliteFile'),
  saveExport: (request) => ipcRenderer.invoke('database:saveExport', request),
  pickDumpDestination: (request) => ipcRenderer.invoke('database:pickDumpDestination', request),
  dump: (request) => ipcRenderer.invoke('database:dump', request),
  cancelJob: (ref) => ipcRenderer.invoke('database:cancelJob', ref),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DatabasePageEvent) =>
      callback(event)
    ipcRenderer.on('database:event', listener)
    return () => ipcRenderer.removeListener('database:event', listener)
  }
} satisfies PreloadApi['database']
