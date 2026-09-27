import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isENOENT } from '../ipc/filesystem-path-containment'
import { writeSecureFile } from '../../shared/secure-file'

export const DATABASE_CONSOLE_MAX_BYTES = 5 * 1024 * 1024

/**
 * Console text lives in `userData/database/consoles/<connectionId>/<consoleId>.sql`, always on
 * this machine, so consoles work the same in local, WSL and SSH workspaces. Callers validate
 * both ids against the id patterns before they reach a path.
 */
export class DatabaseConsoleFiles {
  constructor(private readonly rootDir: string) {}

  async read(connectionId: string, consoleId: string): Promise<string> {
    try {
      return await readFile(this.consolePath(connectionId, consoleId), 'utf8')
    } catch (error) {
      if (isENOENT(error)) {
        return ''
      }
      throw error
    }
  }

  write(connectionId: string, consoleId: string, text: string): void {
    if (Buffer.byteLength(text, 'utf8') > DATABASE_CONSOLE_MAX_BYTES) {
      throw new Error('Console is larger than 5 MB; save large scripts as project files instead.')
    }
    // 0600: consoles often hold credentials and customer data pasted into queries.
    writeSecureFile(this.consolePath(connectionId, consoleId), text, { durable: true })
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await rm(join(this.rootDir, connectionId), { recursive: true, force: true })
  }

  private consolePath(connectionId: string, consoleId: string): string {
    return join(this.rootDir, connectionId, `${consoleId}.sql`)
  }
}
