import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import type { PythonInterpreter } from '../../shared/python-interpreter-types'
import {
  DEFAULT_INTERPRETER_DETECTION_DEPS,
  describeInterpreter,
  detectPythonInterpreters,
  isExecutableFile
} from './python-interpreters'

const ProjectRootSchema = z.string().refine((value) => isAbsolute(value))

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function registerPythonHandlers(): void {
  ipcMain.handle(
    'python:detectInterpreters',
    async (_event, rawRoot: unknown): Promise<PythonInterpreter[]> => {
      const root = ProjectRootSchema.safeParse(rawRoot)
      if (!root.success || !(await isDirectory(root.data))) {
        return []
      }
      return detectPythonInterpreters(root.data)
    }
  )

  ipcMain.handle(
    'python:pickInterpreter',
    async (event, rawRoot: unknown): Promise<PythonInterpreter | null> => {
      const root = ProjectRootSchema.safeParse(rawRoot)
      if (!root.success) {
        return null
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Choose Python interpreter',
        defaultPath: root.data,
        properties: ['openFile', 'showHiddenFiles']
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const path = result.filePaths[0]
      if (result.canceled || !path || !(await isExecutableFile(path))) {
        return null
      }
      return describeInterpreter(
        { path, source: 'custom' },
        root.data,
        DEFAULT_INTERPRETER_DETECTION_DEPS
      )
    }
  )
}
