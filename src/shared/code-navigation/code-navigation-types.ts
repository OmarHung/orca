export const CODE_NAVIGATION_SERVER_KINDS = ['typescript', 'csharp', 'vue'] as const
export type CodeNavigationServerKind = (typeof CODE_NAVIGATION_SERVER_KINDS)[number]

export const CODE_NAVIGATION_FEATURES = [
  'definition',
  'typeDefinition',
  'references',
  'implementation'
] as const
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
  /** True only for a navigation command the renderer observed the user invoke. */
  userInitiated: boolean
  document: CodeNavigationDocument
  position: CodeNavigationPosition
}

export type CodeNavigationHoverQuery = Omit<CodeNavigationQuery, 'feature' | 'userInitiated'>

export type CodeNavigationHover = {
  /** Markdown blocks, shown in order. */
  contents: string[]
  range?: CodeNavigationRange
}

export type CodeNavigationHoverResult =
  | { ok: true; hover: CodeNavigationHover | null }
  | { ok: false; message: string }

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

export type CodeNavigationStatusPhase =
  | 'downloading'
  | 'starting'
  | 'ready'
  | 'failed'
  /** A Nuxt project without its generated `.nuxt/` types; auto-imports cannot resolve. */
  | 'nuxtTypesMissing'

export type CodeNavigationStatusEvent = {
  kind: CodeNavigationServerKind
  root: string
  phase: CodeNavigationStatusPhase
  message?: string
}

const WATCHED_EXTENSIONS: Record<CodeNavigationServerKind, readonly string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  csharp: ['.cs', '.cshtml', '.csproj', '.sln', '.slnx', '.props', '.targets', '.json'],
  vue: ['.vue', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']
}

/** Whether a changed file can affect what this kind of server knows about the workspace. */
export function isCodeNavigationWatchedPath(kind: CodeNavigationServerKind, path: string): boolean {
  const lower = path.toLowerCase()
  return WATCHED_EXTENSIONS[kind].some((extension) => lower.endsWith(extension))
}

export const LANGUAGE_SERVERS_DIR_NAME = 'language-servers'
export const CSHARP_METADATA_DIR_NAME = 'csharp-metadata'
export const TYPESCRIPT_LANGUAGE_SERVER_DIR_NAME = 'typescript-native'
export const VUE_LANGUAGE_SERVER_DIR_NAME = 'vue-vtsls'

const ORCA_OWNED_LANGUAGE_SERVER_DIRS = [
  CSHARP_METADATA_DIR_NAME,
  TYPESCRIPT_LANGUAGE_SERVER_DIR_NAME,
  VUE_LANGUAGE_SERVER_DIR_NAME
] as const

/**
 * Whether a file is one Orca's language servers own (decompiled C#, TypeScript's lib files). They
 * belong to no project, so a tab showing one never moves to a project whose folder contains it.
 */
export function isOrcaLanguageServerFilePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const base = `/${LANGUAGE_SERVERS_DIR_NAME}/`
  return ORCA_OWNED_LANGUAGE_SERVER_DIRS.some((dir) => normalized.includes(`${base}${dir}/`))
}
