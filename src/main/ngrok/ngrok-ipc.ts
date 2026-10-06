import { app, BrowserWindow, ipcMain } from 'electron'
import {
  ngrokAgentPortsSchema,
  ngrokEndpointNameSchema,
  ngrokShareRequestSchema,
  ngrokStopRequestSchema,
  type NgrokResult
} from '../../shared/ngrok/ngrok-types'
import { spawnProcess } from '../../shared/child-process/run-process'
import { resolveNgrokPath } from './ngrok-cli-location'
import { readNgrokConfigText } from './ngrok-config'
import { NGROK_AGENT_ARGS } from './ngrok-managed-agent'
import { NgrokService } from './ngrok-service'

const INVALID_REQUEST = { ok: false, error: 'Invalid ngrok request' } as const

function broadcastChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('ngrok:changed')
    }
  }
}

async function respond<T>(run: () => Promise<T> | T): Promise<NgrokResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerNgrokHandlers(): void {
  const service = new NgrokService({
    resolvePath: resolveNgrokPath,
    spawnAgent: (ngrokPath) => spawnProcess({ program: ngrokPath, args: NGROK_AGENT_ARGS }),
    onChange: broadcastChanged,
    readConfigText: readNgrokConfigText
  })
  ipcMain.handle('ngrok:snapshot', (_event, raw: unknown) => {
    const ports = ngrokAgentPortsSchema.safeParse(raw ?? [])
    return ports.success ? respond(() => service.snapshot(ports.data)) : INVALID_REQUEST
  })
  ipcMain.handle('ngrok:share', (_event, raw: unknown) => {
    const request = ngrokShareRequestSchema.safeParse(raw)
    return request.success ? respond(() => service.share(request.data)) : INVALID_REQUEST
  })
  ipcMain.handle('ngrok:startConfigured', (_event, raw: unknown) => {
    const name = ngrokEndpointNameSchema.safeParse(raw)
    return name.success ? respond(() => service.startConfigured(name.data)) : INVALID_REQUEST
  })
  ipcMain.handle('ngrok:stopEndpoint', (_event, raw: unknown) => {
    const request = ngrokStopRequestSchema.safeParse(raw)
    return request.success ? respond(() => service.stopEndpoint(request.data)) : INVALID_REQUEST
  })
  ipcMain.handle('ngrok:stopAgent', () => respond(() => service.stopAgent()))
  // Why: the agent is Orca's child; left running it would keep the URLs public after Orca quits.
  app.on('will-quit', () => service.stopAgent())
}
