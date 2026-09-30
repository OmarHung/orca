import { isAbsolute, join } from 'node:path'
import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  CODE_NAVIGATION_FEATURES,
  CODE_NAVIGATION_SERVER_KINDS,
  type CodeNavigationHoverResult,
  type CodeNavigationQueryResult
} from '../../shared/code-navigation/code-navigation-types'
import { CodeNavigationService } from './code-navigation-service'
import {
  isLanguageServerInstalled,
  languageServersDir,
  prepareLanguageServerLaunch
} from './language-server-launch'

// Why bounded: renderer input reaches a child process's stdin verbatim.
const MAX_DOCUMENT_CHARS = 8 * 1024 * 1024
const MAX_CHANGES_PER_BATCH = 5_000

const AbsolutePathSchema = z
  .string()
  .max(4_096)
  .refine((value) => isAbsolute(value))

const KindSchema = z.enum(CODE_NAVIGATION_SERVER_KINDS)

const PositionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative()
})

const HoverSchema = z.object({
  kind: KindSchema,
  root: AbsolutePathSchema,
  document: z.object({
    path: AbsolutePathSchema,
    languageId: z.string().regex(/^[a-z]{1,40}$/),
    version: z.number().int().nonnegative(),
    text: z.string().max(MAX_DOCUMENT_CHARS)
  }),
  position: PositionSchema
})

const QuerySchema = HoverSchema.extend({ feature: z.enum(CODE_NAVIGATION_FEATURES) })

const CloseDocumentSchema = z.object({
  kind: KindSchema,
  root: AbsolutePathSchema,
  path: AbsolutePathSchema
})

const FilesChangedSchema = z.object({
  root: AbsolutePathSchema,
  changes: z
    .array(z.object({ kind: z.enum(['create', 'update', 'delete']), path: AbsolutePathSchema }))
    .max(MAX_CHANGES_PER_BATCH)
})

export function registerCodeNavigationHandlers(): void {
  const baseDir = languageServersDir(app.getPath('userData'))
  const service = new CodeNavigationService({
    prepareLaunch: (kind, onDownloading) =>
      prepareLanguageServerLaunch(kind, baseDir, onDownloading),
    isInstalled: (kind) => isLanguageServerInstalled(kind, baseDir),
    metadataDir: join(baseDir, 'csharp-metadata')
  })

  ipcMain.handle(
    'codeNav:query',
    async (event, rawRequest: unknown): Promise<CodeNavigationQueryResult> => {
      const request = QuerySchema.safeParse(rawRequest)
      if (!request.success) {
        return { ok: false, message: 'Invalid code navigation request' }
      }
      const sender = event.sender
      return service.query(request.data, (status) => {
        if (!sender.isDestroyed()) {
          sender.send('codeNav:status', status)
        }
      })
    }
  )

  ipcMain.handle(
    'codeNav:hover',
    async (_event, rawRequest: unknown): Promise<CodeNavigationHoverResult> => {
      const request = HoverSchema.safeParse(rawRequest)
      return request.success
        ? service.hover(request.data)
        : { ok: false, message: 'Invalid code navigation request' }
    }
  )

  ipcMain.handle('codeNav:closeDocument', (_event, rawRequest: unknown): void => {
    const request = CloseDocumentSchema.safeParse(rawRequest)
    if (request.success) {
      service.closeDocument(request.data.kind, request.data.root, request.data.path)
    }
  })

  ipcMain.handle('codeNav:filesChanged', (_event, rawRequest: unknown): void => {
    const request = FilesChangedSchema.safeParse(rawRequest)
    if (request.success) {
      service.filesChanged(request.data.root, request.data.changes)
    }
  })

  // Why: language servers must not outlive Orca.
  app.on('will-quit', () => void service.disposeAll())
}
