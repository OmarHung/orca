import { ipcRenderer } from 'electron'
import type { CodeNavigationStatusEvent } from '../../shared/code-navigation/code-navigation-types'
import type { PreloadApi } from '../api-types'

export const codeNavigationApi = {
  query: (request) => ipcRenderer.invoke('codeNav:query', request),
  hover: (request) => ipcRenderer.invoke('codeNav:hover', request),
  closeDocument: (request) => ipcRenderer.invoke('codeNav:closeDocument', request),
  filesChanged: (request) => ipcRenderer.invoke('codeNav:filesChanged', request),
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: CodeNavigationStatusEvent) =>
      callback(event)
    ipcRenderer.on('codeNav:status', listener)
    return () => ipcRenderer.removeListener('codeNav:status', listener)
  }
} satisfies PreloadApi['codeNavigation']
