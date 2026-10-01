import { getRelativePathInsideRoot } from '@/lib/path'

/** Source files each adapter can bind breakpoints in. */
const EXTENSIONS_BY_ADAPTER: Record<string, readonly string[]> = {
  debugpy: ['.py'],
  'pwa-node': ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue'],
  coreclr: ['.cs', '.fs', '.vb']
}

/** Which breakpoints a place shows or a session takes: under a workspace, in a language. */
export type DebugBreakpointScope = {
  rootPath: string
  /** Narrows to this adapter's languages; unset takes every file under the root. */
  adapterId?: string
}

export function isInDebugScope(scope: DebugBreakpointScope, path: string): boolean {
  if (getRelativePathInsideRoot(path, scope.rootPath) === null) {
    return false
  }
  if (!scope.adapterId) {
    return true
  }
  const lower = path.toLowerCase()
  return (EXTENSIONS_BY_ADAPTER[scope.adapterId] ?? []).some((extension) =>
    lower.endsWith(extension)
  )
}

/**
 * line → bound, merged over the sessions that take `path`: a breakpoint counts as bound when
 * any of them bound it, so a second session of the same language can't mark it unbound.
 */
export function mergeVerifiedLines(
  verifiedBySession: readonly (Record<number, boolean> | undefined)[]
): Record<number, boolean> | undefined {
  const known = verifiedBySession.filter((lines) => lines !== undefined)
  if (known.length === 0) {
    return undefined
  }
  const merged: Record<number, boolean> = {}
  for (const lines of known) {
    for (const [line, bound] of Object.entries(lines)) {
      merged[Number(line)] = merged[Number(line)] === true || bound
    }
  }
  return merged
}
