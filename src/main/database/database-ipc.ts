import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import {
  databaseConnectionDraftSchema,
  databaseConnectionIdSchema
} from '../../shared/database/database-connection-types'
import { databaseIntrospectTargetSchema } from '../../shared/database/database-introspection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import {
  DATABASE_CONSOLE_ID_PATTERN,
  DATABASE_MAX_PAGE_SIZE,
  type DatabaseSessionEvent
} from '../../shared/database/database-session-types'
import { getSecretStore } from '../../shared/secret-store'
import { DatabaseConnectionStore } from './database-connection-store'
import { DATABASE_CONSOLE_MAX_BYTES, DatabaseConsoleFiles } from './database-console-files'
import { DatabasePasswordVault } from './database-password-vault'
import { DatabaseService } from './database-service'
import { DatabaseSessionManager } from './database-session-manager'
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
const ExecuteRequestSchema = ConsoleRefSchema.extend({ sql: SqlSchema, pageSize: PageSizeSchema })
const FetchRequestSchema = ConsoleRefSchema.extend({
  resultId: z.string().min(1).max(64),
  pageSize: PageSizeSchema
})

const INVALID_REQUEST: DatabaseResult<never> = {
  ok: false,
  error: { message: 'Invalid database request' }
}

function broadcast(event: DatabaseSessionEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('database:event', event)
    }
  }
}

function createDatabaseService(): DatabaseService {
  const rootDir = join(app.getPath('userData'), 'database')
  return new DatabaseService({
    connections: new DatabaseConnectionStore(join(rootDir, 'connections.json')),
    passwords: new DatabasePasswordVault(join(rootDir, 'passwords.json'), getSecretStore),
    sessions: new DatabaseSessionManager({ spawnWorker: spawnDatabaseWorker, emit: broadcast }),
    consoles: new DatabaseConsoleFiles(join(rootDir, 'consoles'))
  })
}

export function registerDatabaseHandlers(): void {
  const service = createDatabaseService()

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

  ipcMain.handle('database:execute', (_event, raw: unknown) => {
    const request = ExecuteRequestSchema.safeParse(raw)
    return request.success ? service.execute(request.data) : INVALID_REQUEST
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

  // Why: database server sessions must not outlive Orca.
  app.on('will-quit', () => void service.disposeAll())
}
