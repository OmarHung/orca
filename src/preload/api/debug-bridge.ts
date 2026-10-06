import { ipcRenderer } from 'electron'
import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import type { PreloadApi } from '../api-types'

export const debugApi = {
  start: (sessionId, request) => ipcRenderer.invoke('debug:start', sessionId, request),
  request: (sessionId, command, args) =>
    ipcRenderer.invoke('debug:request', sessionId, command, args),
  stop: (sessionId) => ipcRenderer.invoke('debug:stop', sessionId),
  isDebuggerPort: (args) => ipcRenderer.invoke('debug:isDebuggerPort', args),
  listenerTerminals: (pids) => ipcRenderer.invoke('debug:listenerTerminals', pids),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DebugSessionEvent) =>
      callback(event)
    ipcRenderer.on('debug:event', listener)
    return () => ipcRenderer.removeListener('debug:event', listener)
  }
} satisfies PreloadApi['debug']
