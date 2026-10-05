import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const dotnetContainerApi = {
  launcherPath: () => ipcRenderer.invoke('dotnetContainer:launcherPath'),
  needsLauncher: (input) => ipcRenderer.invoke('dotnetContainer:needsLauncher', input),
  status: () => ipcRenderer.invoke('dotnetContainer:status'),
  stop: () => ipcRenderer.invoke('dotnetContainer:stop'),
  reset: () => ipcRenderer.invoke('dotnetContainer:reset')
} satisfies PreloadApi['dotnetContainer']
