import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  sshCommandIdSchema,
  sshCommandSaveRequestSchema,
  type SshCommand,
  type SshCommandResult
} from '../../shared/ssh-command-types'
import { SshCommandStore } from './ssh-command-store'

function respond<T>(run: () => T): SshCommandResult<T> {
  try {
    return { ok: true, value: run() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Saved commands are only text: nothing here runs them. The renderer sends them to a terminal. */
export function registerSshCommandHandlers(): void {
  // Why lazily: userData is only final once the app has started.
  let store: SshCommandStore | null = null
  const getStore = (): SshCommandStore => {
    store ??= new SshCommandStore(join(app.getPath('userData'), 'ssh-commands.json'))
    return store
  }

  ipcMain.handle('sshCommands:list', (): SshCommandResult<SshCommand[]> =>
    respond(() => getStore().list())
  )
  ipcMain.handle('sshCommands:save', (_event, raw: unknown): SshCommandResult<SshCommand> => {
    const request = sshCommandSaveRequestSchema.safeParse(raw)
    if (!request.success) {
      return { ok: false, error: 'Invalid SSH command' }
    }
    return respond(() => getStore().save(request.data.id, request.data.draft))
  })
  ipcMain.handle('sshCommands:delete', (_event, raw: unknown): SshCommandResult<null> => {
    const id = sshCommandIdSchema.safeParse(raw)
    if (!id.success) {
      return { ok: false, error: 'Invalid SSH command' }
    }
    return respond(() => {
      getStore().delete(id.data)
      return null
    })
  })
}
