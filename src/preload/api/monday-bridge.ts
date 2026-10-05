import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const mondayApi = {
  status: () => ipcRenderer.invoke('monday:status'),
  connect: (token) => ipcRenderer.invoke('monday:connect', { token }),
  disconnect: () => ipcRenderer.invoke('monday:disconnect'),
  listBoards: () => ipcRenderer.invoke('monday:listBoards'),
  listUsers: () => ipcRenderer.invoke('monday:listUsers'),
  loadSchedule: (request) => ipcRenderer.invoke('monday:loadSchedule', request),
  getItem: (itemId) => ipcRenderer.invoke('monday:getItem', itemId)
} satisfies PreloadApi['monday']
