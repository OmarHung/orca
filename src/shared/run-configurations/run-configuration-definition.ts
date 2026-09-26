import type { DebugLaunchTarget } from '../debug/debug-session-types'

/**
 * A saved run configuration. Paths may be relative to the workspace root and may use
 * VS Code variables such as `${workspaceFolder}`; both resolve when it runs.
 */
export type CommandRunConfiguration = {
  type: 'command'
  id: string
  name: string
  command: string
  cwd?: string
  /** Command configurations that must exit 0, in order, before this one starts. */
  beforeLaunch?: string[]
}

export type DebugRunConfiguration = {
  type: 'debug'
  id: string
  name: string
  target: DebugLaunchTarget
  cwd?: string
  args?: string[]
  env?: Record<string, string>
  beforeLaunch?: string[]
}

/** What a sequential compound waits for after starting a member, before starting the next. */
export type CompoundMemberWait = { kind: 'exit' } | { kind: 'delay'; seconds: number }

export type CompoundRunConfiguration = {
  type: 'compound'
  id: string
  name: string
  /** Configurations started together, or in this order when `sequential`. */
  configurations: string[]
  sequential?: boolean
  /** Keyed by member reference; a member without an entry lets the next start at once. */
  waitAfter?: Record<string, CompoundMemberWait>
}

export type RunConfigurationDefinition =
  | CommandRunConfiguration
  | DebugRunConfiguration
  | CompoundRunConfiguration

export type RunConfigurationProblem = { index: number; message: string }

// Why: bound what one file (possibly from a cloned repo) can make the UI and launcher handle.
const MAX_CONFIGURATIONS = 100
const MAX_NAME_LENGTH = 200
const MAX_TEXT_LENGTH = 16_000
const MAX_LIST_ENTRIES = 200
const NODE_SCRIPT_PATTERN = /^[\w:.@/ -]{1,200}$/
const PYTHON_MODULE_PATTERN = /^[A-Za-z_][\w.]{0,199}$/
const ENV_NAME_PATTERN = /^[A-Za-z_][\w.]{0,199}$/
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const
export const MAX_COMPOUND_DELAY_SECONDS = 600

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

function asText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined
}

function asTextList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST_ENTRIES) {
    return undefined
  }
  const items = value
    .map((item) => (typeof item === 'number' ? String(item) : asText(item)))
    .filter((item): item is string => item !== undefined)
  const unique = [...new Set(items)]
  return unique.length > 0 ? unique : undefined
}

/** Program args keep empty strings and surrounding spaces; they are passed verbatim. */
function asArgs(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST_ENTRIES) {
    return undefined
  }
  const args = value
    .map((item) => (typeof item === 'number' ? String(item) : item))
    .filter((item): item is string => typeof item === 'string' && item.length <= MAX_TEXT_LENGTH)
  return args.length > 0 ? args : undefined
}

function asEnv(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const env: Record<string, string> = {}
  for (const [name, raw] of Object.entries(record).slice(0, MAX_LIST_ENTRIES)) {
    const text = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw
    if (ENV_NAME_PATTERN.test(name) && typeof text === 'string' && text.length <= MAX_TEXT_LENGTH) {
      env[name] = text
    }
  }
  return Object.keys(env).length > 0 ? env : undefined
}

function optionalPythonPath(record: Record<string, unknown>): {
  pythonPath?: string
} {
  const pythonPath = asText(record.pythonPath)
  return pythonPath ? { pythonPath } : {}
}

export function normalizeDebugLaunchTarget(value: unknown): DebugLaunchTarget | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  switch (record.kind) {
    case 'python-file': {
      const filePath = asText(record.filePath)
      return filePath ? { kind: 'python-file', filePath, ...optionalPythonPath(record) } : null
    }
    case 'python-module': {
      const module = asText(record.module)
      return module && PYTHON_MODULE_PATTERN.test(module)
        ? { kind: 'python-module', module, ...optionalPythonPath(record) }
        : null
    }
    case 'node-file': {
      const filePath = asText(record.filePath)
      return filePath ? { kind: 'node-file', filePath } : null
    }
    case 'node-script': {
      const script = asText(record.script)
      const packageManager = PACKAGE_MANAGERS.find((name) => name === record.packageManager)
      return script && packageManager && NODE_SCRIPT_PATTERN.test(script)
        ? { kind: 'node-script', packageManager, script }
        : null
    }
    case 'dotnet-project': {
      const projectFile = asText(record.projectFile)
      const launchProfile = asText(record.launchProfile, MAX_NAME_LENGTH)
      return projectFile && /\.(cs|fs|vb)proj$/i.test(projectFile)
        ? {
            kind: 'dotnet-project',
            projectFile,
            ...(launchProfile ? { launchProfile } : {})
          }
        : null
    }
    case 'dotnet-program': {
      const program = asText(record.program)
      return program && /\.(dll|exe)$/i.test(program) ? { kind: 'dotnet-program', program } : null
    }
    default:
      return null
  }
}

function asMemberWait(value: unknown): CompoundMemberWait | undefined {
  const record = asRecord(value)
  if (record?.kind === 'exit') {
    return { kind: 'exit' }
  }
  const seconds = record?.seconds
  return record?.kind === 'delay' &&
    typeof seconds === 'number' &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds <= MAX_COMPOUND_DELAY_SECONDS
    ? { kind: 'delay', seconds }
    : undefined
}

function asWaitAfter(
  value: unknown,
  configurations: readonly string[]
): Record<string, CompoundMemberWait> | undefined {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const waits: Record<string, CompoundMemberWait> = {}
  for (const reference of configurations) {
    const wait = asMemberWait(record[reference])
    if (wait) {
      waits[reference] = wait
    }
  }
  return Object.keys(waits).length > 0 ? waits : undefined
}

function inferType(record: Record<string, unknown>): RunConfigurationDefinition['type'] | null {
  if (record.type === 'command' || record.type === 'debug' || record.type === 'compound') {
    return record.type
  }
  if ('target' in record) {
    return 'debug'
  }
  if ('configurations' in record) {
    return 'compound'
  }
  return 'command' in record ? 'command' : null
}

function normalizeOne(value: unknown): RunConfigurationDefinition | string {
  const record = asRecord(value)
  if (!record) {
    return 'Entry must be a mapping.'
  }
  const name = asText(record.name, MAX_NAME_LENGTH)
  if (!name) {
    return 'Name is required.'
  }
  const id = asText(record.id, MAX_NAME_LENGTH) ?? name
  const cwd = asText(record.cwd)
  const beforeLaunch = asTextList(record.beforeLaunch)
  switch (inferType(record)) {
    case 'command': {
      const command = asText(record.command)
      if (!command) {
        return `"${name}": command is required.`
      }
      return {
        type: 'command',
        id,
        name,
        command,
        ...(cwd ? { cwd } : {}),
        ...(beforeLaunch ? { beforeLaunch } : {})
      }
    }
    case 'debug': {
      const target = normalizeDebugLaunchTarget(record.target)
      if (!target) {
        return `"${name}": the debug target is missing or not supported.`
      }
      const args = asArgs(record.args)
      const env = asEnv(record.env)
      return {
        type: 'debug',
        id,
        name,
        target,
        ...(cwd ? { cwd } : {}),
        ...(args ? { args } : {}),
        ...(env ? { env } : {}),
        ...(beforeLaunch ? { beforeLaunch } : {})
      }
    }
    case 'compound': {
      const configurations = asTextList(record.configurations)
      if (!configurations) {
        return `"${name}": list the configurations to start.`
      }
      const sequential = record.sequential === true
      const waitAfter = sequential ? asWaitAfter(record.waitAfter, configurations) : undefined
      return {
        type: 'compound',
        id,
        name,
        configurations,
        ...(sequential ? { sequential } : {}),
        ...(waitAfter ? { waitAfter } : {})
      }
    }
    case null:
      return `"${name}": needs a command, a debug target or a list of configurations.`
  }
}

export function normalizeRunConfigurationDefinitions(value: unknown): {
  configurations: RunConfigurationDefinition[]
  problems: RunConfigurationProblem[]
} {
  if (!Array.isArray(value)) {
    return { configurations: [], problems: [] }
  }
  const configurations: RunConfigurationDefinition[] = []
  const problems: RunConfigurationProblem[] = []
  const seenIds = new Set<string>()
  value.slice(0, MAX_CONFIGURATIONS).forEach((entry, index) => {
    const result = normalizeOne(entry)
    if (typeof result === 'string') {
      problems.push({ index, message: result })
      return
    }
    if (seenIds.has(result.id)) {
      problems.push({
        index,
        message: `"${result.id}" is defined more than once.`
      })
      return
    }
    seenIds.add(result.id)
    configurations.push(result)
  })
  return { configurations, problems }
}

/** References name a configuration by id, or by name for hand-written orca.yaml entries. */
export function findRunConfiguration<T extends RunConfigurationDefinition>(
  configurations: readonly T[],
  reference: string
): T | null {
  return (
    configurations.find((configuration) => configuration.id === reference) ??
    configurations.find((configuration) => configuration.name === reference) ??
    null
  )
}
