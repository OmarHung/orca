import type { CodeNavigationServerKind } from '../../../../shared/code-navigation/code-navigation-types'

export type CodeNavigationLanguage = { kind: CodeNavigationServerKind; languageId: string }

const typescript = (languageId: string): CodeNavigationLanguage => ({
  kind: 'typescript',
  languageId
})

const LANGUAGES_BY_EXTENSION: Record<string, CodeNavigationLanguage> = {
  '.ts': typescript('typescript'),
  '.mts': typescript('typescript'),
  '.cts': typescript('typescript'),
  '.tsx': typescript('typescriptreact'),
  '.js': typescript('javascript'),
  '.mjs': typescript('javascript'),
  '.cjs': typescript('javascript'),
  '.jsx': typescript('javascriptreact'),
  '.cs': { kind: 'csharp', languageId: 'csharp' },
  // Why the C# server: csharp-ls resolves the C# inside Razor views (run with razor-support).
  '.cshtml': { kind: 'csharp', languageId: 'razor' }
}

/** Monaco language ids whose navigation Orca routes through a language server. */
export const CODE_NAVIGATION_MONACO_LANGUAGES = [
  'typescript',
  'javascript',
  'csharp',
  'razor'
] as const

/** The server and LSP language id for a file, or null when no server handles it. */
export function codeNavigationLanguageForPath(path: string): CodeNavigationLanguage | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (LANGUAGES_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null) : null
}
