import { isAbsolute } from 'node:path'
import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  DEBUG_RENDERER_COMMANDS,
  type DebugRequestResult,
  type DebugStartResult
} from '../../shared/debug/debug-session-types'
import { DebugSessionManager, defaultDebugAdaptersDir } from './debug-session-manager'
import { registerPythonHandlers } from '../python/python-ipc'

// Why: renderer input is untrusted — it chooses what program runs and what the adapter receives.
const SessionIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)

const AbsolutePathSchema = z.string().refine((value) => isAbsolute(value))

const LaunchTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('python-file'),
    filePath: AbsolutePathSchema,
    pythonPath: AbsolutePathSchema.optional()
  }),
  z.object({ kind: z.literal('node-file'), filePath: AbsolutePathSchema }),
  z.object({
    kind: z.literal('node-script'),
    packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
    // Why a strict pattern: the script name ends up as a process argument.
    script: z.string().regex(/^[\w:.@/ -]{1,200}$/)
  }),
  z.object({
    kind: z.literal('dotnet-project'),
    projectFile: AbsolutePathSchema.refine((value) => /\.(cs|fs|vb)proj$/i.test(value)),
    launchProfile: z.string().min(1).max(200).optional()
  })
])

const StartRequestSchema = z.object({
  worktreeId: z.string().min(1),
  cwd: AbsolutePathSchema,
  target: LaunchTargetSchema,
  breakpoints: z.record(
    z.string().min(1),
    z.array(
      z.object({
        line: z.number().int().positive(),
        column: z.number().int().positive().optional(),
        condition: z.string().optional(),
        hitCondition: z.string().optional(),
        logMessage: z.string().optional()
      })
    )
  )
})

const RequestArgsSchema = z.record(z.string(), z.unknown())

export function registerDebugHandlers(): void {
  registerPythonHandlers()
  const sessions = new DebugSessionManager(defaultDebugAdaptersDir(app.getPath('userData')))

  ipcMain.handle(
    'debug:start',
    async (event, rawSessionId: unknown, rawRequest: unknown): Promise<DebugStartResult> => {
      const sessionId = SessionIdSchema.safeParse(rawSessionId)
      const request = StartRequestSchema.safeParse(rawRequest)
      if (!sessionId.success || !request.success) {
        return { ok: false, message: 'Invalid debug start request' }
      }
      const sender = event.sender
      const stopOnDestroy = (): void => void sessions.stop(sessionId.data)
      sender.once('destroyed', stopOnDestroy)
      return sessions.start(sessionId.data, request.data, {
        send: (sessionEvent) => {
          if (!sender.isDestroyed()) {
            sender.send('debug:event', sessionEvent)
          }
          if (sessionEvent.kind === 'phase' && sessionEvent.phase === 'ended') {
            sender.removeListener('destroyed', stopOnDestroy)
          }
        }
      })
    }
  )

  ipcMain.handle(
    'debug:request',
    async (
      _event,
      rawSessionId: unknown,
      rawCommand: unknown,
      rawArgs: unknown
    ): Promise<DebugRequestResult> => {
      const sessionId = SessionIdSchema.safeParse(rawSessionId)
      const command = z.enum(DEBUG_RENDERER_COMMANDS).safeParse(rawCommand)
      const args = RequestArgsSchema.safeParse(rawArgs ?? {})
      if (!sessionId.success || !command.success || !args.success) {
        return { ok: false, message: 'Invalid debug request' }
      }
      return sessions.request(sessionId.data, command.data, args.data)
    }
  )

  ipcMain.handle('debug:stop', async (_event, rawSessionId: unknown): Promise<void> => {
    const sessionId = SessionIdSchema.safeParse(rawSessionId)
    if (sessionId.success) {
      await sessions.stop(sessionId.data)
    }
  })

  // Why: debuggee processes must not outlive Orca.
  app.on('will-quit', () => sessions.disposeAll())
}
