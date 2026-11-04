import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const sshCommandsApi = {
  list: () => ipcRenderer.invoke('sshCommands:list'),
  save: (request) => ipcRenderer.invoke('sshCommands:save', request),
  delete: (id) => ipcRenderer.invoke('sshCommands:delete', id)
} satisfies PreloadApi['sshCommands']
