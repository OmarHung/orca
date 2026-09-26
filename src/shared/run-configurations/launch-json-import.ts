import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import {
  normalizeRunConfigurationDefinitions,
  type RunConfigurationDefinition
} from './run-configuration-definition'

export type LaunchJsonSkipReason = 'attach' | 'unsupported-type' | 'no-entry-point' | 'invalid'

export type LaunchJsonImport =
  | {
      ok: true
      configurations: RunConfigurationDefinition[]
      skipped: { name: string; reason: LaunchJsonSkipReason }[]
      /** VS Code tasks are not imported; the user re-creates them as Before launch steps. */
      preLaunchTasks: { name: string; task: string }[]
    }
  | { ok: false }

const PYTHON_TYPES = new Set(['debugpy', 'python'])
const NODE_TYPES = new Set(['node', 'pwa-node'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

type RawEntry = Record<string, unknown>

function asRecord(value: unknown): RawEntry | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** launch.json allows `args` as one string; split it on whitespace like VS Code's shell mode. */
function args(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  const line = text(value)
  return line ? line.trim().split(/\s+/) : undefined
}

export function launchConfigurationId(name: string): string {
  return `launch:${name}`
}

function debugTarget(entry: RawEntry): Record<string, unknown> | LaunchJsonSkipReason {
  const type = text(entry.type) ?? ''
  const program = text(entry.program)
  if (PYTHON_TYPES.has(type)) {
    const pythonPath = text(entry.python)
    const python = pythonPath ? { pythonPath } : {}
    const module = text(entry.module)
    if (module) {
      return { kind: 'python-module', module, ...python }
    }
    return program ? { kind: 'python-file', filePath: program, ...python } : 'no-entry-point'
  }
  if (NODE_TYPES.has(type)) {
    if (program) {
      return { kind: 'node-file', filePath: program }
    }
    const runtime = text(entry.runtimeExecutable)
    const runtimeArgs = args(entry.runtimeArgs) ?? []
    const isScript = runtimeArgs[0] === 'run' || runtimeArgs[0] === 'run-script'
    return runtime && PACKAGE_MANAGERS.has(runtime) && isScript && runtimeArgs[1]
      ? { kind: 'node-script', packageManager: runtime, script: runtimeArgs[1] }
      : 'no-entry-point'
  }
  if (type === 'coreclr') {
    return program ? { kind: 'dotnet-program', program } : 'no-entry-point'
  }
  return 'unsupported-type'
}

function toDefinition(
  entry: RawEntry,
  name: string
): Record<string, unknown> | LaunchJsonSkipReason {
  if (entry.request === 'attach') {
    return 'attach'
  }
  const target = debugTarget(entry)
  if (typeof target === 'string') {
    return target
  }
  const programArgs = args(entry.args)
  return {
    type: 'debug',
    id: launchConfigurationId(name),
    name,
    target,
    ...(text(entry.cwd) ? { cwd: entry.cwd } : {}),
    ...(programArgs && programArgs.length > 0 ? { args: programArgs } : {}),
    ...(asRecord(entry.env) ? { env: entry.env } : {})
  }
}

function compoundDefinition(entry: RawEntry, name: string): Record<string, unknown> {
  const members = Array.isArray(entry.configurations) ? entry.configurations : []
  return {
    type: 'compound',
    id: launchConfigurationId(name),
    name,
    configurations: members
      .map((member) => text(member) ?? text(asRecord(member)?.name))
      .filter((member): member is string => member !== undefined)
      .map(launchConfigurationId)
  }
}

/** Converts `.vscode/launch.json` into Orca run configurations; variables stay unexpanded. */
export function importLaunchJson(content: string): LaunchJsonImport {
  const errors: ParseError[] = []
  const root = asRecord(parseJsonc(content, errors, { allowTrailingComma: true }))
  if (!root || errors.length > 0 || !Array.isArray(root.configurations)) {
    return { ok: false }
  }
  const raw: Record<string, unknown>[] = []
  const skipped: { name: string; reason: LaunchJsonSkipReason }[] = []
  const preLaunchTasks: { name: string; task: string }[] = []
  for (const value of root.configurations) {
    const entry = asRecord(value)
    const name = text(entry?.name)
    if (!entry || !name) {
      continue
    }
    const definition = toDefinition(entry, name)
    if (typeof definition === 'string') {
      skipped.push({ name, reason: definition })
      continue
    }
    raw.push(definition)
    const task = text(entry.preLaunchTask)
    if (task) {
      preLaunchTasks.push({ name, task })
    }
  }
  for (const value of Array.isArray(root.compounds) ? root.compounds : []) {
    const entry = asRecord(value)
    const name = text(entry?.name)
    if (entry && name) {
      raw.push(compoundDefinition(entry, name))
    }
  }
  const { configurations, problems } = normalizeRunConfigurationDefinitions(raw)
  for (const problem of problems) {
    const name = text(raw[problem.index]?.name) ?? `#${problem.index + 1}`
    skipped.push({ name, reason: 'invalid' })
  }
  return { ok: true, configurations, skipped, preLaunchTasks }
}
