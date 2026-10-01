import { isPathInsideOrEqual } from '../cross-platform-path'

// Why by layout: the execution host may be remote, so its real home folder is not known here.
// Mounted drives (`/Volumes/Data`, `/mnt/c`, `/media/me/usb`) count too: emptying one wipes a disk.
const HOME_OR_SYSTEM_FOLDER =
  /^(?:\/(?:Users|home)(?:\/[^/]+)?|\/root|\/(?:Volumes|mnt)\/[^/]+|\/media(?:\/[^/]+){1,2}|[A-Za-z]:\/(?:Users(?:\/[^/]+)?|Windows|Program Files(?: \(x86\))?|ProgramData))$/i

function normalized(path: string): string {
  return path.replace(/\\/g, '/').replace(/(.)\/+$/, '$1')
}

function isFilesystemRootOrTopLevel(path: string): boolean {
  if (/^[A-Za-z]:\/?$/.test(path)) {
    return true
  }
  if (path.startsWith('//')) {
    // A UNC share root (`//server/share`) or anything above it.
    return path.split('/').filter(Boolean).length <= 2
  }
  return path.split('/').filter(Boolean).length <= 1
}

/**
 * Why a folder may not be emptied before an export, or null when it may: a root, top-level, home or
 * system folder, or one holding the workspace or the build context, would take source files with it.
 */
export function outputFolderEmptyingProblem(
  folder: string,
  protect: { workspaceRoot: string; contextDir: string }
): 'not-absolute' | 'system-folder' | 'contains-sources' | null {
  const path = normalized(folder)
  if (!path.startsWith('/') && !/^[A-Za-z]:(?:\/|$)/.test(path)) {
    return 'not-absolute'
  }
  if (isFilesystemRootOrTopLevel(path) || HOME_OR_SYSTEM_FOLDER.test(path)) {
    return 'system-folder'
  }
  const holds = (inner: string): boolean => isPathInsideOrEqual(folder, inner)
  return holds(protect.workspaceRoot) || holds(protect.contextDir) ? 'contains-sources' : null
}
