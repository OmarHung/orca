import { parseDocument } from 'yaml'
import { isOrcaYamlTextWithinLimit, MAX_ORCA_YAML_ALIAS_COUNT } from '../orca-yaml-file-limit'
import { joinProjectPath } from './project-path'
import {
  quoteShellArgument,
  type DetectedRunConfiguration,
  type RunConfigurationKind
} from './run-configuration-types'

/** Compose's own lookup order; `docker compose` without `-f` uses the first one present. */
const DEFAULT_COMPOSE_FILES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml'
]
const NAMED_COMPOSE_FILE = /^(?:docker-)?compose[.-](.+)\.ya?ml$/

export type ComposeFile = { name: string; text: string | null }

type ComposeService = Record<string, unknown>

export function isDockerComposeFile(name: string): boolean {
  return DEFAULT_COMPOSE_FILES.includes(name) || NAMED_COMPOSE_FILE.test(name)
}

/** `compose.override.yaml` and the like, which compose merges into the default file by itself. */
function isOverrideFile(name: string): boolean {
  return NAMED_COMPOSE_FILE.exec(name)?.[1] === 'override'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function field(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value
}

/** Services in file order; null when the file cannot be read as compose YAML. */
function readServices(text: string | null): Map<string, ComposeService> | null {
  if (text === null || !isOrcaYamlTextWithinLimit(text)) {
    return null
  }
  try {
    // Why merge: compose files share settings through `<<: *anchor` merge keys.
    const document = parseDocument(text, {
      keepSourceTokens: false,
      logLevel: 'silent',
      prettyErrors: false,
      merge: true
    })
    if (document.errors.length > 0) {
      return null
    }
    const root: unknown = document.toJS({ maxAliasCount: MAX_ORCA_YAML_ALIAS_COUNT })
    const services = isRecord(root) ? field(root, 'services') : undefined
    return new Map(
      Object.entries(isRecord(services) ? services : {}).map(([name, service]) => [
        name,
        isRecord(service) ? service : {}
      ])
    )
  } catch {
    return null
  }
}

function dependenciesOf(service: ComposeService): string[] {
  const dependsOn = field(service, 'depends_on')
  const links = field(service, 'links')
  return [
    ...(Array.isArray(dependsOn) ? dependsOn : isRecord(dependsOn) ? Object.keys(dependsOn) : []),
    ...(Array.isArray(links) ? links.map((link) => String(link).split(':')[0]) : [])
  ].filter((name): name is string => typeof name === 'string')
}

/**
 * Whether a named file layers onto the default one (`-f compose.yaml -f compose.prod.yaml`): one of
 * its services cannot start on its own, or depends on a service it does not define.
 */
function isOverlay(services: ReadonlyMap<string, ComposeService>): boolean {
  return [...services.values()].some(
    (service) =>
      ['image', 'build', 'extends'].every((key) => field(service, key) === undefined) ||
      dependenciesOf(service).some((name) => !services.has(name))
  )
}

function serviceNames(...files: (ReadonlyMap<string, ComposeService> | null)[]): string[] {
  return [...new Set(files.flatMap((services) => [...(services?.keys() ?? [])]))]
}

function composeRuns(options: {
  projectDir: string
  fileName: string
  /** The `-f` files, empty when compose finds the default file by itself. */
  composeFiles: readonly string[]
  services: readonly string[]
}): DetectedRunConfiguration[] {
  const fileArgs = options.composeFiles.map(quoteShellArgument)
  if (fileArgs.some((arg) => arg === null)) {
    return []
  }
  const compose = ['docker compose', ...fileArgs.map((arg) => `-f ${arg}`)].join(' ')
  const services = options.services.flatMap((name) => {
    const quoted = quoteShellArgument(name)
    return quoted === null ? [] : [[`up --build ${name}`, 'run', `up --build ${quoted}`] as const]
  })
  // Why --build in the foreground: rebuilding after a code change is the usual run, and its
  // logs stay in the Run panel where Stop ends the containers.
  const entries: (readonly [string, RunConfigurationKind, string])[] = [
    ['up', 'run', 'up'],
    ['up --build', 'run', 'up --build'],
    ['up -d', 'run', 'up -d'],
    ...services,
    ['build', 'build', 'build'],
    ['down', 'other', 'down'],
    ['logs -f', 'other', 'logs -f']
  ]
  const projectFile = joinProjectPath(options.projectDir, options.fileName)
  return entries.map(([name, kind, args]): DetectedRunConfiguration => ({
    id: `docker:${options.projectDir}:compose:${options.fileName}:${name}`,
    ecosystem: 'docker',
    projectName: options.fileName,
    projectDir: options.projectDir,
    projectFile,
    kind,
    name,
    command: `${compose} ${args}`
  }))
}

/**
 * Up (whole stack, rebuilt, detached, or one service rebuilt), build, down and logs for each compose file in a
 * folder; named files such as `compose.prod.yaml` run layered onto the default one when they
 * cannot stand alone.
 */
export function detectDockerComposeRunConfigurations(options: {
  projectDir: string
  files: readonly ComposeFile[]
}): DetectedRunConfiguration[] {
  const byName = new Map(options.files.map((file) => [file.name, file.text]))
  const defaultName = DEFAULT_COMPOSE_FILES.find((name) => byName.has(name)) ?? null
  const overrideName = options.files.map((file) => file.name).find(isOverrideFile) ?? null
  const defaultServices =
    defaultName === null ? null : readServices(byName.get(defaultName) ?? null)
  const configurations: DetectedRunConfiguration[] = []
  if (defaultName !== null) {
    const overrideServices = overrideName ? readServices(byName.get(overrideName) ?? null) : null
    configurations.push(
      ...composeRuns({
        projectDir: options.projectDir,
        fileName: defaultName,
        composeFiles: [],
        services: serviceNames(defaultServices, overrideServices)
      })
    )
  }
  const named = options.files
    .filter((file) => NAMED_COMPOSE_FILE.test(file.name) && !isOverrideFile(file.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const file of named) {
    const services = readServices(file.text)
    const layered = defaultName !== null && services !== null && isOverlay(services)
    configurations.push(
      ...composeRuns({
        projectDir: options.projectDir,
        fileName: file.name,
        composeFiles: layered ? [defaultName, file.name] : [file.name],
        services: layered ? serviceNames(defaultServices, services) : serviceNames(services)
      })
    )
  }
  return configurations
}
