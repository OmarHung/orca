import { getRelativePathInsideRoot } from '@/lib/path'

const POSIX_SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/
const WINDOWS_SAFE = /^[A-Za-z0-9_.\\/:-]+$/

function quoteArgument(value: string, platform: 'windows' | 'posix'): string {
  if (platform === 'windows') {
    // Why no quoting when safe: a quoted program path needs `&` in PowerShell but not in cmd.
    return WINDOWS_SAFE.test(value) ? value : `"${value}"`
  }
  return POSIX_SAFE.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function relativeWhenInside(path: string, root: string, platform: 'windows' | 'posix'): string {
  const relative = getRelativePathInsideRoot(path, root)
  if (!relative) {
    return path
  }
  return platform === 'windows' ? relative.replace(/\//g, '\\') : relative
}

/**
 * Shell text that runs `filePath` with `interpreterPath` from the project root, e.g.
 * `.venv/bin/python scripts/server.py`. Paths inside the project stay relative so the
 * command reads the way the user would type it.
 */
export function buildPythonRunCommand(options: {
  interpreterPath: string
  filePath: string
  projectRoot: string
  platform: 'windows' | 'posix'
}): string {
  const { projectRoot, platform } = options
  const interpreter = relativeWhenInside(options.interpreterPath, projectRoot, platform)
  // Why `./` on POSIX: a bare relative path like `.venv/bin/python` is fine, but a program
  // name without a slash would be looked up on PATH instead.
  const program =
    platform === 'posix' && !interpreter.includes('/') ? `./${interpreter}` : interpreter
  const file = relativeWhenInside(options.filePath, projectRoot, platform)
  return `${quoteArgument(program, platform)} ${quoteArgument(file, platform)}`
}
