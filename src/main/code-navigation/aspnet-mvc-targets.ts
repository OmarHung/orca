import { access, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LspLocation } from './lsp-locations'
import { isLspRange } from './lsp-locations'
import type { MvcConstruct } from './aspnet-mvc-constructs'

const VIEW_EXTENSION = '.cshtml'
const CLASS_SYMBOL_KIND = 5
const METHOD_SYMBOL_KIND = 6
const TOP_OF_FILE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

export type MvcTargetDeps = {
  /** The workspace root; the project search never climbs above it. */
  root: string
  fileExists: (path: string) => Promise<boolean>
  listDir: (dir: string) => Promise<string[] | null>
  workspaceSymbols: (query: string) => Promise<unknown>
}

export const nodeMvcFileSystem: Pick<MvcTargetDeps, 'fileExists' | 'listDir'> = {
  fileExists: (path) =>
    access(path).then(
      () => true,
      () => false
    ),
  listDir: (dir) => readdir(dir).catch(() => null)
}

type SymbolEntry = { name: string; kind: number; location: LspLocation }

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The folder of the .csproj that owns `filePath`, else the workspace root. */
async function projectDir(filePath: string, deps: MvcTargetDeps): Promise<string> {
  for (let dir = dirname(filePath); isInside(dir, deps.root); dir = dirname(dir)) {
    const entries = await deps.listDir(dir)
    if (entries?.some((entry) => entry.toLowerCase().endsWith('.csproj'))) {
      return dir
    }
    if (dirname(dir) === dir) {
      break
    }
  }
  return deps.root
}

async function firstExisting(paths: readonly string[], deps: MvcTargetDeps) {
  for (const path of paths) {
    if (await deps.fileExists(path)) {
      return path
    }
  }
  return null
}

/** Where ASP.NET looks for a view, in its search order (areas first, then shared folders). */
async function viewCandidates(
  construct: Extract<MvcConstruct, { kind: 'view' }>,
  documentPath: string,
  deps: MvcTargetDeps
): Promise<string[]> {
  const name = construct.name ?? construct.context.action
  if (!name) {
    return []
  }
  const file = name.toLowerCase().endsWith(VIEW_EXTENSION) ? name : `${name}${VIEW_EXTENSION}`
  const project = await projectDir(documentPath, deps)
  if (/^~?\//.test(name)) {
    return [join(project, file.replace(/^~?\//, ''))]
  }
  const isView = documentPath.toLowerCase().endsWith(VIEW_EXTENSION)
  if (name.includes('/')) {
    return [join(isView ? dirname(documentPath) : project, file)]
  }
  const { area, controller } = construct.context
  return [
    // Why first for views: a partial beside the view wins, which also covers feature folders.
    ...(isView ? [join(dirname(documentPath), file)] : []),
    ...(area && controller ? [join(project, 'Areas', area, 'Views', controller, file)] : []),
    ...(area ? [join(project, 'Areas', area, 'Views', 'Shared', file)] : []),
    ...(controller ? [join(project, 'Views', controller, file)] : []),
    join(project, 'Views', 'Shared', file),
    ...(construct.partial ? [join(project, 'Pages', 'Shared', file)] : [])
  ]
}

function toSymbolEntries(result: unknown): SymbolEntry[] {
  if (!Array.isArray(result)) {
    return []
  }
  return result.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const name = 'name' in item ? item.name : undefined
    const kind = 'kind' in item ? item.kind : undefined
    const location = 'location' in item ? item.location : undefined
    if (typeof name !== 'string' || typeof kind !== 'number') {
      return []
    }
    if (typeof location !== 'object' || location === null || !('uri' in location)) {
      return []
    }
    const uri = location.uri
    const range = 'range' in location && isLspRange(location.range) ? location.range : TOP_OF_FILE
    return typeof uri === 'string' ? [{ name, kind, location: { uri, range } }] : []
  })
}

/** Symbols in the named area, or outside any area when none is named; all when nothing fits. */
function preferArea(entries: SymbolEntry[], area: string | null): SymbolEntry[] {
  const inAreas = (entry: SymbolEntry) => /\/Areas\//i.test(entry.location.uri)
  const preferred = area
    ? entries.filter((entry) =>
        entry.location.uri.toLowerCase().includes(`/areas/${area.toLowerCase()}/`)
      )
    : entries.filter((entry) => !inAreas(entry))
  return preferred.length > 0 ? preferred : entries
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function controllerClasses(controller: string, area: string | null, deps: MvcTargetDeps) {
  const className = `${controller}Controller`
  const classes = toSymbolEntries(await deps.workspaceSymbols(className)).filter(
    (entry) => entry.kind === CLASS_SYMBOL_KIND && entry.name === className
  )
  return preferArea(classes, area).map((entry) => entry.location)
}

async function actionMethods(
  construct: Extract<MvcConstruct, { kind: 'action' }>,
  deps: MvcTargetDeps
): Promise<LspLocation[]> {
  const { action, area, controller } = construct
  if (!controller) {
    return []
  }
  // csharp-ls names a method `IActionResult HomeController.Index(int id)`.
  const pattern = new RegExp(
    `\\b${escapeRegExp(controller)}Controller\\.${escapeRegExp(action)}\\(`
  )
  const methods = toSymbolEntries(await deps.workspaceSymbols(action)).filter(
    (entry) => entry.kind === METHOD_SYMBOL_KIND && pattern.test(entry.name)
  )
  const preferred = preferArea(methods, area).map((entry) => entry.location)
  // Why the class: an inherited or renamed ([ActionName]) action still lands in its controller.
  return preferred.length > 0 ? preferred : controllerClasses(controller, area, deps)
}

/** Files and symbols an MVC reference points at; empty when nothing matches the conventions. */
export async function resolveMvcConstruct(
  construct: MvcConstruct,
  documentPath: string,
  deps: MvcTargetDeps
): Promise<LspLocation[]> {
  switch (construct.kind) {
    case 'view': {
      const view = await firstExisting(await viewCandidates(construct, documentPath, deps), deps)
      return view ? [{ uri: pathToFileURL(view).href, range: TOP_OF_FILE }] : []
    }
    case 'action':
      return actionMethods(construct, deps)
    case 'controller':
      return controllerClasses(construct.controller, construct.area, deps)
  }
}
