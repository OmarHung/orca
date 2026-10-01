import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import type { CodeNavigationPosition } from '../../shared/code-navigation/code-navigation-types'
import type { LspLocation } from './lsp-locations'

const TOP_OF_FILE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
// `typeof import('…').name` (imports.d.ts) or `typeof import('…')['default']` (components.d.ts).
const AUTO_IMPORT =
  /typeof import\((['"])([^'"]+)\1\)(?:\.([A-Za-z_$][\w$]*)|\[(['"])([A-Za-z_$][\w$]*)\4\])/

export type NuxtResolveDeps = {
  readText: (path: string) => Promise<string | null>
  /** A definition query on a file the editor may not have open. */
  definitionAt: (
    path: string,
    text: string,
    position: CodeNavigationPosition
  ) => Promise<LspLocation[]>
}

function filePath(location: LspLocation): string | null {
  try {
    return location.uri.startsWith('file:') ? fileURLToPath(location.uri) : null
  } catch {
    return null
  }
}

function isGenerated(location: LspLocation, projectRoot: string): boolean {
  const path = filePath(location)
  return path !== null && isPathInsideOrEqual(join(projectRoot, '.nuxt'), path)
}

function inNodeModules(location: LspLocation): boolean {
  return /[\\/]node_modules[\\/]/.test(filePath(location) ?? '')
}

function locationKey(location: LspLocation): string {
  const { line, character } = location.range.start
  return `${location.uri}\0${line}\0${character}`
}

/** The source behind one `.nuxt/` declaration line; empty when the line is no auto-import. */
async function resolveGenerated(
  location: LspLocation,
  deps: NuxtResolveDeps
): Promise<LspLocation[]> {
  const path = filePath(location)
  const text = path ? await deps.readText(path) : null
  const line = location.range.start.line
  const match = text?.split(/\r?\n/)[line]?.match(AUTO_IMPORT)
  if (!path || text == null || !match || match.index === undefined) {
    return []
  }
  const [whole, , modulePath, member] = match
  if (member) {
    const character = match.index + whole.length - member.length
    return deps.definitionAt(path, text, { line, character })
  }
  // Why only `.vue`: a component module is the file itself; anything else needs the server.
  return modulePath.endsWith('.vue')
    ? [{ uri: pathToFileURL(resolve(dirname(path), modulePath)).href, range: TOP_OF_FILE }]
    : []
}

/**
 * Nuxt's auto-imports are declared in generated `.nuxt/` files, so a definition lands there (or
 * on a library's generic type) instead of in the composable, store or component. This follows
 * each such declaration to its source, the way Rider and Volar users expect.
 */
export async function resolveNuxtLocations(
  locations: LspLocation[],
  projectRoot: string,
  deps: NuxtResolveDeps
): Promise<LspLocation[]> {
  const generated = locations.filter((location) => isGenerated(location, projectRoot))
  if (generated.length === 0) {
    return locations
  }
  const resolved = (
    await Promise.all(generated.map((location) => resolveGenerated(location, deps)))
  )
    .flat()
    .filter((location) => !isGenerated(location, projectRoot))
  if (resolved.length === 0) {
    return locations
  }
  // Why drop library types: `useCartStore` also lands on pinia's generic store type.
  const foundProjectSource = resolved.some((location) => !inNodeModules(location))
  const others = locations.filter(
    (location) =>
      !isGenerated(location, projectRoot) && !(foundProjectSource && inNodeModules(location))
  )
  const unique = new Map(
    [...resolved, ...others].map((location) => [locationKey(location), location])
  )
  return [...unique.values()]
}

/** Usages without the `.nuxt/` declarations, unless those are all there is. */
export function withoutNuxtGeneratedLocations(
  locations: LspLocation[],
  projectRoot: string
): LspLocation[] {
  const kept = locations.filter((location) => !isGenerated(location, projectRoot))
  return kept.length > 0 ? kept : locations
}
