import {
  FolderArchive,
  FolderCheck,
  FolderClock,
  FolderCode,
  FolderCog,
  FolderDown,
  FolderGit2,
  FolderKey,
  FolderOutput,
  FolderPen,
  FolderTree,
  type LucideIcon
} from 'lucide-react'

function group(names: readonly string[], icon: LucideIcon): [string, LucideIcon][] {
  return names.map((name) => [name, icon])
}

const FOLDER_ICON_BY_NAME: ReadonlyMap<string, LucideIcon> = new Map([
  ...group(['.git', '.github', '.gitlab', '.husky'], FolderGit2),
  ...group(['src', 'source', 'lib', 'app', 'scripts', 'bin'], FolderCode),
  ...group(['packages', 'apps', 'modules'], FolderTree),
  ...group(
    [
      'node_modules',
      'bower_components',
      'vendor',
      '.venv',
      'venv',
      '__pycache__',
      '.pnpm-store',
      '.yarn'
    ],
    FolderArchive
  ),
  ...group(
    ['dist', 'build', 'out', 'output', 'target', 'release', '.next', '.nuxt', '.output'],
    FolderOutput
  ),
  ...group(
    ['config', 'configs', '.config', 'settings', '.vscode', '.idea', '.circleci', '.devcontainer'],
    FolderCog
  ),
  ...group(
    ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', '__mocks__', 'fixtures', 'coverage'],
    FolderCheck
  ),
  ...group(['docs', 'doc', 'documentation'], FolderPen),
  ...group(['.ssh', '.gnupg', 'certs', 'keys', 'secrets'], FolderKey),
  ...group(['logs', 'log', 'tmp', 'temp', '.cache', 'cache'], FolderClock),
  ...group(['downloads'], FolderDown)
])

/** A folder's name-specific icon, or null so callers keep their own open/closed glyph. */
export function getFolderTypeIcon(folderPath: string | undefined | null): LucideIcon | null {
  const segments = (folderPath ?? '').split(/[/\\]/).filter(Boolean)
  const name = segments.at(-1)
  return name ? (FOLDER_ICON_BY_NAME.get(name.toLowerCase()) ?? null) : null
}
