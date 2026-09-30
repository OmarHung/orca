export const CODE_NAVIGATION_SERVER_KINDS = ['typescript', 'csharp'] as const
export type CodeNavigationServerKind = (typeof CODE_NAVIGATION_SERVER_KINDS)[number]

export const CODE_NAVIGATION_FEATURES = ['definition', 'references', 'implementation'] as const
export type CodeNavigationFeature = (typeof CODE_NAVIGATION_FEATURES)[number]

/** LSP position: zero-based line and UTF-16 character offset (Monaco columns are UTF-16 too). */
export type CodeNavigationPosition = { line: number; character: number }
export type CodeNavigationRange = { start: CodeNavigationPosition; end: CodeNavigationPosition }

export type CodeNavigationDocument = {
  path: string
  languageId: string
  /** Monaco's model version; main only resends the text when it changes. */
  version: number
  text: string
}

export type CodeNavigationQuery = {
  kind: CodeNavigationServerKind
  root: string
  feature: CodeNavigationFeature
  document: CodeNavigationDocument
  position: CodeNavigationPosition
}

export type CodeNavigationLocation = {
  path: string
  range: CodeNavigationRange
}

export type CodeNavigationQueryResult =
  | {
      ok: true
      locations: CodeNavigationLocation[]
      /** File text for targets other than the queried document, so peek can preview them. */
      previews: Record<string, string>
    }
  | { ok: false; message: string }

export type CodeNavigationFileChange = {
  kind: 'create' | 'update' | 'delete'
  path: string
}

export type CodeNavigationStatusPhase = 'downloading' | 'starting' | 'ready' | 'failed'

export type CodeNavigationStatusEvent = {
  kind: CodeNavigationServerKind
  root: string
  phase: CodeNavigationStatusPhase
  message?: string
}

const WATCHED_EXTENSIONS: Record<CodeNavigationServerKind, readonly string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  csharp: ['.cs', '.csproj', '.sln', '.slnx', '.props', '.targets', '.json']
}

/** Whether a changed file can affect what this kind of server knows about the workspace. */
export function isCodeNavigationWatchedPath(kind: CodeNavigationServerKind, path: string): boolean {
  const lower = path.toLowerCase()
  return WATCHED_EXTENSIONS[kind].some((extension) => lower.endsWith(extension))
}
