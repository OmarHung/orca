import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { databaseConnectionIdSchema } from '../../shared/database/database-connection-types'
import {
  DATABASE_JOB_ID_PATTERN,
  databaseDumpOptionsSchema,
  databaseDumpRequestSchema,
  type DatabaseDumpDestination,
  type DatabasePickDumpDestinationRequest
} from '../../shared/database/database-dump-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseDumpDestinations } from './database-dump-destinations'
import { exportBaseName } from './database-export-file'
import type { DatabaseJobService } from './database-job-service'
import type { DumpDestination } from './worker/dump/dump-output'

const JobRefSchema = z
  .object({
    connectionId: databaseConnectionIdSchema,
    jobId: z.string().regex(DATABASE_JOB_ID_PATTERN)
  })
  .strict()
const DumpJobSchema = JobRefSchema.extend({
  token: z.string().uuid(),
  dump: databaseDumpRequestSchema
})
const PickDestinationSchema = z
  .object({
    layout: databaseDumpOptionsSchema.shape.layout,
    suggestedName: z.string().max(200)
  })
  .strict()

const INVALID_REQUEST: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Invalid database request' }
}

// Why a cap: past this many same-named folders something else is wrong; the last name is reused.
const MAX_FOLDER_SUFFIX = 1000

/** A new folder under `parent`, so a dump never mixes its files with ones already there. */
function freshFolder(parent: string, name: string): string {
  for (let suffix = 1; suffix < MAX_FOLDER_SUFFIX; suffix += 1) {
    const candidate = join(parent, suffix === 1 ? name : `${name} (${suffix})`)
    if (!existsSync(candidate)) {
      return candidate
    }
  }
  return join(parent, `${name} (${MAX_FOLDER_SUFFIX})`)
}

/** Asks where the dump goes: a file to save, or a folder to hold a file per table. */
async function chooseDestination(
  window: BrowserWindow | null,
  request: DatabasePickDumpDestinationRequest
): Promise<DumpDestination | null> {
  const name = exportBaseName(request.suggestedName)
  if (request.layout === 'single-file') {
    const options: Electron.SaveDialogOptions = {
      defaultPath: `${name}.sql`,
      filters: [{ name: 'SQL', extensions: ['sql'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : { kind: 'file', path: result.filePath }
  }
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory']
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const parent = result.filePaths[0]
  return result.canceled || !parent ? null : { kind: 'folder', path: freshFolder(parent, name) }
}

export function registerDatabaseJobHandlers(
  jobs: DatabaseJobService,
  destinations: DatabaseDumpDestinations
): void {
  ipcMain.handle(
    'database:pickDumpDestination',
    async (event, raw: unknown): Promise<DatabaseDumpDestination | null> => {
      const request = PickDestinationSchema.safeParse(raw)
      if (!request.success) {
        return null
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const destination = await chooseDestination(window, request.data)
      return destination ? destinations.register(destination) : null
    }
  )

  ipcMain.handle('database:dump', (_event, raw: unknown) => {
    const request = DumpJobSchema.safeParse(raw)
    return request.success ? jobs.dump(request.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:cancelJob', (_event, raw: unknown) => {
    const ref = JobRefSchema.safeParse(raw)
    return ref.success ? jobs.cancelJob(ref.data) : false
  })
}
