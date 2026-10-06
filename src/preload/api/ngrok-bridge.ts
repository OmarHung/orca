import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const ngrokApi = {
  snapshot: (agentPorts) => ipcRenderer.invoke('ngrok:snapshot', agentPorts),
  share: (request) => ipcRenderer.invoke('ngrok:share', request),
  startConfigured: (name) => ipcRenderer.invoke('ngrok:startConfigured', name),
  stopEndpoint: (request) => ipcRenderer.invoke('ngrok:stopEndpoint', request),
  stopAgent: () => ipcRenderer.invoke('ngrok:stopAgent'),
  onChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('ngrok:changed', listener)
    return () => ipcRenderer.removeListener('ngrok:changed', listener)
  }
} satisfies PreloadApi['ngrok']
