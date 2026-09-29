import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../shared/app-environment'

/** Keep this reachable from plain-Node entries; the build guard rejects Electron imports here. */
export type WorkerEntryLayout = {
  isPackaged: boolean
  /** Undefined on a non-Electron host: `process.resourcesPath` is Electron-only. */
  resourcesPath: string | undefined
  moduleDir: string
}

export function resolveWorkerThreadEntryPath(
  layout: WorkerEntryLayout,
  entryFileName: string
): string {
  // Plain-Node orcad can be packaged without Electron resources; its workers live beside the module.
  if (layout.isPackaged && layout.resourcesPath) {
    return join(layout.resourcesPath, 'app.asar', 'out', 'main', entryFileName)
  }
  return join(layout.moduleDir, entryFileName)
}

/**
 * Resolve a built entry that a forked child process runs from disk (packaging asarUnpacks these).
 * @param layout - Packaged flag plus both candidate roots.
 * @param entryFileName - Built file name, e.g. `database-worker-entry.js`.
 * @returns Path passed to `fork()`.
 */
export function resolveForkedProcessEntryPath(
  layout: WorkerEntryLayout,
  entryFileName: string,
  pathExists: (path: string) => boolean = existsSync
): string {
  if (layout.isPackaged && layout.resourcesPath) {
    return join(layout.resourcesPath, 'app.asar.unpacked', 'out', 'main', entryFileName)
  }
  const adjacent = join(layout.moduleDir, entryFileName)
  // Rollup can factor the caller into out/main/chunks; entries stay in out/main.
  return pathExists(adjacent) ? adjacent : join(layout.moduleDir, '..', entryFileName)
}

// The build's `chunkFileNames` folder; worker entries sit one level up, beside the main entry.
const SHARED_CHUNK_DIR_NAME = 'chunks'

export function currentWorkerEntryLayout(moduleDir: string): WorkerEntryLayout {
  return {
    isPackaged: hasAppEnvironment() && getAppEnvironment().isPackaged(),
    resourcesPath:
      'resourcesPath' in process && typeof process.resourcesPath === 'string'
        ? process.resourcesPath
        : undefined,
    // Why: a caller bundled into a shared chunk sees `out/main/chunks` as its `__dirname`.
    moduleDir: basename(moduleDir) === SHARED_CHUNK_DIR_NAME ? dirname(moduleDir) : moduleDir
  }
}
