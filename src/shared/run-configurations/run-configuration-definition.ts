import type { DebugLaunchTarget } from '../debug/debug-session-types'
import {
  DOTNET_PROJECT_FILE_PATTERN,
  normalizeDotnetPublish,
  type DotnetPublishRunConfiguration
} from './dotnet-publish-configuration'
import { asArgs, asEnv, asRecord, asText, asTextList } from './run-configuration-values'

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
  | DotnetPublishRunConfiguration
  | CompoundRunConfiguration

export type RunConfigurationProblem = { index: number; message: string }

// Why: bound what one file (possibly from a cloned repo) can make the UI and launcher handle.
const MAX_CONFIGURATIONS = 100
const MAX_NAME_LENGTH = 200
const NODE_SCRIPT_PATTERN = /^[\w:.@/ -]{1,200}$/
const PYTHON_MODULE_PATTERN = /^[A-Za-z_][\w.]{0,199}$/
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const
export const MAX_COMPOUND_DELAY_SECONDS = 600

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
      return projectFile && DOTNET_PROJECT_FILE_PATTERN.test(projectFile)
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
  if (
    record.type === 'command' ||
    record.type === 'debug' ||
    record.type === 'dotnet-publish' ||
    record.type === 'compound'
  ) {
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
    case 'dotnet-publish':
      return normalizeDotnetPublish(record, { id, name, ...(beforeLaunch ? { beforeLaunch } : {}) })
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
