/** What `${…}` variables in a run configuration resolve against. */
export type RunConfigurationVariableContext = {
  /** Absolute root of the workspace the configuration runs in. */
  workspaceFolder: string
  /** Absolute path of the file open in the editor, if any. */
  file?: string
}

export type ExpansionResult = { ok: true; value: string } | { ok: false; variable: string }

// Why: a repo can name files anything; inside a shell command a value may only contain
// characters no supported shell (sh, PowerShell, cmd) treats specially. Spaces get quoted.
const SHELL_SAFE_VALUE = /^[\w@%+=:,./\\ ~-]*$/

function shellValue(value: string): string | null {
  if (!SHELL_SAFE_VALUE.test(value)) {
    return null
  }
  return value.includes(' ') ? `"${value}"` : value
}

// Why: VS Code variables this launcher cannot know (settings, commands, prompts, the
// user's environment in the renderer) must fail loudly instead of running a wrong path.
const UNSUPPORTED_NAMESPACES = /^(env|config|command|input):/

function separatorOf(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts.at(-1) ?? ''
}

function parentOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : path
}

function relativeTo(root: string, path: string): string {
  const prefix = root.replace(/[\\/]+$/, '')
  if (
    path.toLowerCase().startsWith(prefix.toLowerCase()) &&
    /[\\/]/.test(path[prefix.length] ?? '')
  ) {
    return path.slice(prefix.length + 1)
  }
  return path
}

function fileVariables(file: string, root: string): Record<string, string> {
  const base = lastSegment(file)
  const dot = base.lastIndexOf('.')
  const relativeFile = relativeTo(root, file)
  return {
    file,
    fileBasename: base,
    fileBasenameNoExtension: dot > 0 ? base.slice(0, dot) : base,
    fileExtname: dot > 0 ? base.slice(dot) : '',
    fileDirname: parentOf(file),
    relativeFile,
    relativeFileDirname: parentOf(relativeFile) === relativeFile ? '' : parentOf(relativeFile)
  }
}

const FILE_VARIABLES = new Set([
  'file',
  'fileBasename',
  'fileBasenameNoExtension',
  'fileExtname',
  'fileDirname',
  'relativeFile',
  'relativeFileDirname'
])

/**
 * Expands the VS Code variables Orca can resolve. Other `${NAME}` forms are left alone
 * because shell commands use the same syntax for their own variables.
 */
export function expandRunConfigurationVariables(
  text: string,
  context: RunConfigurationVariableContext,
  options: { shell?: boolean } = {}
): ExpansionResult {
  const separator = separatorOf(context.workspaceFolder)
  const known: Record<string, string> = {
    workspaceFolder: context.workspaceFolder,
    workspaceRoot: context.workspaceFolder,
    workspaceFolderBasename: lastSegment(context.workspaceFolder.replace(/[\\/]+$/, '')),
    pathSeparator: separator,
    '/': separator,
    ...(context.file ? fileVariables(context.file, context.workspaceFolder) : {})
  }
  let failed: string | null = null
  const value = text.replace(/\$\{([^}]+)\}/g, (match, name: string) => {
    if (failed) {
      return match
    }
    if (name in known) {
      const value = options.shell ? shellValue(known[name]) : known[name]
      if (value === null) {
        failed = match
        return match
      }
      return value
    }
    if (UNSUPPORTED_NAMESPACES.test(name) || FILE_VARIABLES.has(name)) {
      failed = match
    }
    return match
  })
  return failed ? { ok: false, variable: failed } : { ok: true, value }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Expands variables, then anchors a relative path at the workspace root. */
export function resolveRunConfigurationPath(
  path: string,
  context: RunConfigurationVariableContext
): ExpansionResult {
  const expanded = expandRunConfigurationVariables(path, context)
  if (!expanded.ok || isAbsolutePath(expanded.value)) {
    return expanded
  }
  const separator = separatorOf(context.workspaceFolder)
  const relative = expanded.value.replace(/^\.[\\/]/, '').replace(/[\\/]+/g, separator)
  const root = context.workspaceFolder.replace(/[\\/]+$/, '')
  return {
    ok: true,
    value: relative === '.' || !relative ? root : `${root}${separator}${relative}`
  }
}
