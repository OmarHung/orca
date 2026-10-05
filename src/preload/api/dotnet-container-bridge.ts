import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const dotnetContainerApi = {
  launcherPath: () => ipcRenderer.invoke('dotnetContainer:launcherPath')
} satisfies PreloadApi['dotnetContainer']
