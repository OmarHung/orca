import type { CodeNavigationQuery } from '../../shared/code-navigation/code-navigation-types'
import type { LanguageServerSession } from './language-server-session'
import { readPreviewFile } from './navigation-target-files'
import { csharpImplementations } from './csharp-mediatr-handlers'
import { detectMvcConstruct } from './aspnet-mvc-constructs'
import { nodeMvcFileSystem, resolveMvcConstruct, type MvcTargetDeps } from './aspnet-mvc-targets'
import { resolveNuxtLocations, withoutNuxtGeneratedLocations } from './nuxt-auto-imports'
import type { LspLocation } from './lsp-locations'

export type ServerLocationDeps = {
  readPreview?: (path: string) => Promise<string | null>
  mvcFileSystem?: Pick<MvcTargetDeps, 'fileExists' | 'listDir'>
}

/** A stand-in document version that changes whenever the text does (FNV-1a). */
function textVersion(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  }
  return hash >>> 0
}

/**
 * ASP.NET MVC references the C# server cannot follow: views named by convention
 * (`return View()`, `<partial name>`) and actions named in strings (`asp-action`,
 * `RedirectToAction`). Rider resolves these too; a definition on one lands on its target.
 */
async function mvcLocations(
  session: LanguageServerSession,
  request: CodeNavigationQuery,
  deps: ServerLocationDeps
): Promise<LspLocation[]> {
  if (request.kind !== 'csharp' || request.feature !== 'definition') {
    return []
  }
  const construct = detectMvcConstruct(request.document, request.position)
  if (!construct) {
    return []
  }
  return resolveMvcConstruct(construct, request.document.path, {
    root: request.root,
    ...(deps.mvcFileSystem ?? nodeMvcFileSystem),
    workspaceSymbols: (query) => session.request('workspace/symbol', { query })
  })
}

function nuxtLocations(
  session: LanguageServerSession,
  request: CodeNavigationQuery,
  locations: LspLocation[],
  readText: (path: string) => Promise<string | null>
): LspLocation[] | Promise<LspLocation[]> {
  if (request.feature === 'references') {
    return withoutNuxtGeneratedLocations(locations, request.root)
  }
  if (request.feature !== 'definition') {
    return locations
  }
  return resolveNuxtLocations(locations, request.root, {
    readText,
    definitionAt: (path, text, position) =>
      session.query(
        'definition',
        { path, languageId: 'typescript', version: textVersion(text), text },
        position
      )
  })
}

/** What the server answers, plus the follow-ups Orca adds for MVC, MediatR and Nuxt. */
export async function serverLocations(
  session: LanguageServerSession,
  request: CodeNavigationQuery,
  nuxt: boolean,
  deps: ServerLocationDeps
): Promise<LspLocation[]> {
  const mvc = await mvcLocations(session, request, deps)
  if (mvc.length > 0) {
    return mvc
  }
  const read = deps.readPreview ?? readPreviewFile
  if (request.kind === 'csharp' && request.feature === 'implementation') {
    return csharpImplementations(
      session,
      request.document,
      request.position,
      async (path) => (await read(path))?.split(/\r?\n/) ?? null
    )
  }
  const locations = await session.query(request.feature, request.document, request.position)
  return nuxt ? nuxtLocations(session, request, locations, read) : locations
}
