import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  currentWorkerEntryLayout,
  resolveForkedProcessEntryPath
} from '../worker-thread-entry-path'

const ENTRY_FILENAME = 'database-worker-entry.js'

/**
 * Where the built database worker entry lives. Threads may load it from inside app.asar; a forked
 * process needs the real file, which packaging places in app.asar.unpacked (see asarUnpack).
 */
export function resolveDatabaseWorkerEntryPath(options: { unpacked: boolean }): string {
  const layout = currentWorkerEntryLayout(__dirname)
  if (options.unpacked) {
    return resolveForkedProcessEntryPath(layout, ENTRY_FILENAME)
  }
  if (layout.isPackaged && layout.resourcesPath) {
    return join(layout.resourcesPath, 'app.asar', 'out', 'main', ENTRY_FILENAME)
  }
  const adjacent = join(__dirname, ENTRY_FILENAME)
  // Rollup can factor the caller into out/main/chunks; worker entries stay in out/main.
  return existsSync(adjacent) ? adjacent : join(__dirname, '..', ENTRY_FILENAME)
}
