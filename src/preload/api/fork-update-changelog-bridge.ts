import { ipcRenderer } from 'electron'
import type { ForkUpdateChangelog } from '../../shared/fork-update-changelog'
import type { PreloadApi } from '../api-types'

export const forkUpdateChangelogApi = {
  get: () => ipcRenderer.invoke('forkChangelog:get'),
  ensureSummary: (locale) => ipcRenderer.invoke('forkChangelog:ensureSummary', locale),
  regenerate: (locale) => ipcRenderer.invoke('forkChangelog:regenerate', locale),
  markSeen: () => ipcRenderer.invoke('forkChangelog:markSeen'),
  onChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      changelog: ForkUpdateChangelog | null
    ): void => callback(changelog)
    ipcRenderer.on('forkChangelog:changed', listener)
    return () => ipcRenderer.removeListener('forkChangelog:changed', listener)
  }
} satisfies PreloadApi['forkUpdateChangelog']
