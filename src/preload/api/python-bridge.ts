import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const pythonApi = {
  detectInterpreters: (projectRoot) => ipcRenderer.invoke('python:detectInterpreters', projectRoot),
  pickInterpreter: (projectRoot) => ipcRenderer.invoke('python:pickInterpreter', projectRoot)
} satisfies PreloadApi['python']
