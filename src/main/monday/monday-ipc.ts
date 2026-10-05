import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { getSecretStore } from '../../shared/secret-store'
import {
  mondayConnectSchema,
  mondayIdSchema,
  mondayLoadScheduleSchema,
  type MondayResult
} from '../../shared/monday/monday-types'
import { MondayApiError } from './monday-graphql-client'
import { MondayService } from './monday-service'

const INVALID_REQUEST = {
  ok: false,
  error: { kind: 'api', message: 'Invalid monday request' }
} as const

async function respond<T>(run: () => Promise<T> | T): Promise<MondayResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof MondayApiError) {
      return { ok: false, error: { kind: error.kind, message: error.message } }
    }
    return {
      ok: false,
      error: { kind: 'api', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

// Why dev-only: a packaged build must never send the token anywhere but monday. Read per call so
// e2e can point it at a fake server started after launch.
function testEndpoint(): string | undefined {
  const override = process.env.ORCA_MONDAY_API_URL_FOR_TESTS
  return override && !app.isPackaged ? override : undefined
}

export function registerMondayHandlers(): void {
  const service = new MondayService({
    dataDir: join(app.getPath('userData'), 'monday'),
    secretStore: getSecretStore,
    endpoint: testEndpoint
  })

  ipcMain.handle('monday:status', () => respond(() => service.status()))
  ipcMain.handle('monday:connect', (_event, input: unknown) => {
    const parsed = mondayConnectSchema.safeParse(input)
    return parsed.success ? respond(() => service.connect(parsed.data.token)) : INVALID_REQUEST
  })
  ipcMain.handle('monday:disconnect', () => respond(() => service.disconnect()))
  ipcMain.handle('monday:listBoards', () => respond(() => service.listBoards()))
  ipcMain.handle('monday:listUsers', () => respond(() => service.listUsers()))
  ipcMain.handle('monday:loadSchedule', (_event, input: unknown) => {
    const parsed = mondayLoadScheduleSchema.safeParse(input)
    return parsed.success ? respond(() => service.loadSchedule(parsed.data)) : INVALID_REQUEST
  })
  ipcMain.handle('monday:getItem', (_event, input: unknown) => {
    const parsed = mondayIdSchema.safeParse(input)
    return parsed.success ? respond(() => service.getItem(parsed.data)) : INVALID_REQUEST
  })
}
