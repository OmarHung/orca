import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  databaseConnectionDraftSchema,
  databaseConnectionIdSchema
} from '../../shared/database/database-connection-types'
import {
  DATABASE_EXPORT_FORMATS,
  DATABASE_EXPORT_MAX_CHARS
} from '../../shared/database/database-export-types'
import { databaseDdlTargetSchema } from '../../shared/database/database-ddl-types'
import { databaseIntrospectTargetSchema } from '../../shared/database/database-introspection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import {
  DATABASE_CONSOLE_ID_PATTERN,
  DATABASE_MAX_PAGE_SIZE,
  type DatabasePageEvent
} from '../../shared/database/database-session-types'
import { getSecretStore } from '../../shared/secret-store'
import { DatabaseConnectionStore } from './database-connection-store'
import { DatabaseDumpDestinations } from './database-dump-destinations'
import { registerDatabaseJobHandlers } from './database-job-ipc'
import { DatabaseJobService } from './database-job-service'
import { saveDatabaseExport } from './database-export-file'
import { DATABASE_CONSOLE_MAX_BYTES, DatabaseConsoleFiles } from './database-console-files'
import { DatabasePasswordVault } from './database-password-vault'
import { DatabaseQueryHistory } from './database-query-history'
import { DatabaseService } from './database-service'
import { DatabaseSessionManager } from './database-session-manager'
import { createDatabaseTunnelOpener } from './database-ssh-tunnel'
import { spawnDatabaseProcess } from './database-process-spawn'
import { spawnDatabaseWorker } from './database-worker-client'

// Why bounded: renderer input is untrusted and these values reach files and the server.
const PasswordSchema = z.string().max(4096)
const ConsoleRefSchema = z
  .object({
    connectionId: databaseConnectionIdSchema,
    consoleId: z.string().regex(DATABASE_CONSOLE_ID_PATTERN)
  })
  .strict()
const PageSizeSchema = z.number().int().min(1).max(DATABASE_MAX_PAGE_SIZE)
const SqlSchema = z.string().min(1).max(DATABASE_CONSOLE_MAX_BYTES)

const SaveRequestSchema = z
  .object({
    id: databaseConnectionIdSchema.optional(),
    draft: databaseConnectionDraftSchema,
    password: PasswordSchema.nullable().optional()
  })
  .strict()
const TestRequestSchema = z
  .object({
    draft: databaseConnectionDraftSchema,
    password: PasswordSchema.optional(),
    connectionId: databaseConnectionIdSchema.optional()
  })
  .strict()
const ExecuteRequestSchema = ConsoleRefSchema.extend({
  sql: SqlSchema,
  pageSize: PageSizeSchema,
  recordHistory: z.boolean().optional(),
  schema: z.string().min(1).max(256).optional(),
  database: z.string().min(1).max(256).optional()
})
const FetchRequestSchema = ConsoleRefSchema.extend({
  resultId: z.string().min(1).max(64),
  pageSize: PageSizeSchema
})

const SaveExportSchema = z
  .object({
    suggestedName: z.string().max(200),
    format: z.enum(DATABASE_EXPORT_FORMATS),
    content: z.string().max(DATABASE_EXPORT_MAX_CHARS)
  })
  .strict()

const INVALID_REQUEST: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Invalid database request' }
}

function broadcast(event: DatabasePageEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('database:event', event)
    }
  }
}

function createDatabaseServices(): {
  service: DatabaseService
  jobs: DatabaseJobService
  destinations: DatabaseDumpDestinations
} {
  const rootDir = join(app.getPath('userData'), 'database')
  const sessions = new DatabaseSessionManager({
    // Why a process for SQLite: its statements run in native code a thread can't interrupt.
    spawnWorker: (driver) => (driver === 'sqlite' ? spawnDatabaseProcess() : spawnDatabaseWorker()),
    emit: broadcast,
    emitJobProgress: broadcast,
    openTunnel: createDatabaseTunnelOpener()
  })
  const service = new DatabaseService({
    connections: new DatabaseConnectionStore(join(rootDir, 'connections.json')),
    passwords: new DatabasePasswordVault(join(rootDir, 'passwords.json'), getSecretStore),
    sessions,
    consoles: new DatabaseConsoleFiles(join(rootDir, 'consoles')),
    history: new DatabaseQueryHistory(join(rootDir, 'history'))
  })
  const destinations = new DatabaseDumpDestinations()
  return { service, jobs: new DatabaseJobService({ sessions, destinations }), destinations }
}

export function registerDatabaseHandlers(): void {
  const { service, jobs, destinations } = createDatabaseServices()
  registerDatabaseJobHandlers(jobs, destinations)

  ipcMain.handle('database:listConnections', () => service.listConnections())
  ipcMain.handle('database:encryptionStatus', () => service.encryptionStatus())

  ipcMain.handle('database:saveConnection', (_event, raw: unknown) => {
    const request = SaveRequestSchema.safeParse(raw)
    return request.success ? service.saveConnection(request.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:deleteConnection', async (_event, raw: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(raw)
    if (id.success) {
      await service.deleteConnection(id.data)
    }
  })

  ipcMain.handle('database:testConnection', (_event, raw: unknown) => {
    const request = TestRequestSchema.safeParse(raw)
    return request.success ? service.testConnection(request.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:connect', (_event, rawId: unknown, rawPassword: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(rawId)
    const password = PasswordSchema.optional().safeParse(rawPassword)
    return id.success && password.success
      ? service.connect(id.data, password.data)
      : INVALID_REQUEST
  })

  ipcMain.handle('database:disconnect', async (_event, raw: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(raw)
    if (id.success) {
      await service.disconnect(id.data)
    }
  })

  ipcMain.handle('database:introspect', (_event, rawId: unknown, rawTarget: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(rawId)
    const target = databaseIntrospectTargetSchema.safeParse(rawTarget)
    return id.success && target.success ? service.introspect(id.data, target.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:ddl', (_event, rawId: unknown, rawTarget: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(rawId)
    const target = databaseDdlTargetSchema.safeParse(rawTarget)
    return id.success && target.success ? service.ddl(id.data, target.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:execute', (_event, raw: unknown) => {
    const request = ExecuteRequestSchema.safeParse(raw)
    return request.success ? service.execute(request.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:listHistory', (_event, raw: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(raw)
    return id.success ? service.listHistory(id.data) : []
  })

  ipcMain.handle('database:clearHistory', async (_event, raw: unknown) => {
    const id = databaseConnectionIdSchema.safeParse(raw)
    if (id.success) {
      await service.clearHistory(id.data)
    }
  })

  ipcMain.handle('database:fetchMore', (_event, raw: unknown) => {
    const request = FetchRequestSchema.safeParse(raw)
    return request.success ? service.fetchMore(request.data) : INVALID_REQUEST
  })

  ipcMain.handle('database:cancel', (_event, raw: unknown) => {
    const ref = ConsoleRefSchema.safeParse(raw)
    return ref.success ? service.cancel(ref.data) : false
  })

  ipcMain.handle('database:closeConsole', async (_event, raw: unknown) => {
    const ref = ConsoleRefSchema.safeParse(raw)
    if (ref.success) {
      await service.closeConsole(ref.data)
    }
  })

  ipcMain.handle('database:readConsole', (_event, raw: unknown) => {
    const ref = ConsoleRefSchema.safeParse(raw)
    return ref.success ? service.readConsole(ref.data) : ''
  })

  ipcMain.handle('database:writeConsole', (_event, rawRef: unknown, rawText: unknown) => {
    const ref = ConsoleRefSchema.safeParse(rawRef)
    const text = z.string().safeParse(rawText)
    if (ref.success && text.success) {
      service.writeConsole(ref.data, text.data)
    }
  })

  ipcMain.handle('database:pickSqliteFile', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'SQLite', extensions: ['sqlite', 'sqlite3', 'db', 'db3', 's3db', 'sl3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('database:saveExport', (event, raw: unknown) => {
    const request = SaveExportSchema.safeParse(raw)
    return request.success
      ? saveDatabaseExport(BrowserWindow.fromWebContents(event.sender), request.data)
      : INVALID_REQUEST
  })

  // Why: database server sessions and half-written dumps must not outlive Orca.
  app.on('will-quit', () => {
    jobs.discardRunning()
    void service.disposeAll()
  })
}
