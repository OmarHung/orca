import {
  quoteShellArgument,
  type DetectedRunConfiguration,
  type RunConfigurationKind
} from './run-configuration-types'

export type NodePackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm'

const LOCKFILES: [string, NodePackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm']
]

type PackageJson = {
  name?: unknown
  private?: unknown
  packageManager?: unknown
  scripts?: unknown
}

function parsePackageJson(text: string): PackageJson | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export function detectNodePackageManager(
  packageManagerField: unknown,
  fileNames: readonly string[]
): NodePackageManager {
  if (typeof packageManagerField === 'string') {
    const name = packageManagerField.split('@')[0]
    if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') {
      return name
    }
  }
  const names = new Set(fileNames)
  return LOCKFILES.find(([lockfile]) => names.has(lockfile))?.[1] ?? 'npm'
}

export function classifyScript(name: string): RunConfigurationKind {
  if (/^(build|compile)\b/.test(name)) {
    return 'build'
  }
  if (/^(dev|start|serve|watch|preview)\b/.test(name)) {
    return 'run'
  }
  if (/^test\b/.test(name)) {
    return 'test'
  }
  if (/^(publish|release|deploy)\b/.test(name)) {
    return 'publish'
  }
  return 'other'
}

/** One configuration per package.json script, plus `<pm> publish` for a publishable package. */
export function detectNodeRunConfigurations(options: {
  projectDir: string
  fileNames: readonly string[]
  packageJsonText: string
}): DetectedRunConfiguration[] {
  const packageJson = parsePackageJson(options.packageJsonText)
  if (!packageJson) {
    return []
  }
  const { projectDir } = options
  const manager = detectNodePackageManager(packageJson.packageManager, options.fileNames)
  const projectName =
    typeof packageJson.name === 'string' && packageJson.name
      ? packageJson.name
      : (projectDir.split(/[\\/]/).pop() ?? projectDir)
  const scripts =
    typeof packageJson.scripts === 'object' && packageJson.scripts !== null
      ? Object.entries(packageJson.scripts).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      : []
  const base = { ecosystem: 'node' as const, projectName, projectDir }
  const configurations: DetectedRunConfiguration[] = scripts.map(([name]) => ({
    ...base,
    id: `node:${projectDir}:script:${name}`,
    kind: classifyScript(name),
    name,
    command: `${manager} run ${quoteShellArgument(name)}`
  }))
  const publishable = packageJson.private !== true && typeof packageJson.name === 'string'
  if (publishable && !scripts.some(([name]) => name === 'publish')) {
    configurations.push({
      ...base,
      id: `node:${projectDir}:publish`,
      kind: 'publish',
      name: `${manager} publish`,
      command: `${manager} publish`
    })
  }
  return configurations
}
