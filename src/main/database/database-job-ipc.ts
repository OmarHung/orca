import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { databaseConnectionIdSchema } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import {
  DATABASE_JOB_ID_PATTERN,
  databaseScriptOptionsSchema
} from '../../shared/database/database-script-types'
import type { DatabaseJobService } from './database-job-service'
import type { DatabaseScriptPicks } from './database-script-picks'

const JobRefSchema = z
  .object({
    connectionId: databaseConnectionIdSchema,
    jobId: z.string().regex(DATABASE_JOB_ID_PATTERN)
  })
  .strict()
const RunScriptSchema = JobRefSchema.extend({
  token: z.string().uuid(),
  options: databaseScriptOptionsSchema
})

const INVALID_REQUEST: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Invalid database request' }
}

/** Opens the script picker over the requesting window. */
async function chooseScriptFiles(window: BrowserWindow | null): Promise<string[] | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'SQL', extensions: ['sql'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths
}

export function registerDatabaseJobHandlers(
  jobs: DatabaseJobService,
  picks: DatabaseScriptPicks
): void {
  ipcMain.handle('database:pickScripts', async (event) =>
    picks.register(await chooseScriptFiles(BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle('database:runScript', (_event, raw: unknown) => {
    const request = RunScriptSchema.safeParse(raw)
    return request.success ? jobs.runScript(request.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:cancelJob', (_event, raw: unknown) => {
    const ref = JobRefSchema.safeParse(raw)
    return ref.success ? jobs.cancelJob(ref.data) : false
  })
}
