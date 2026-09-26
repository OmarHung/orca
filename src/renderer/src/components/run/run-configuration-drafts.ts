import type { DebugLaunchTarget } from '../../../../shared/debug/debug-session-types'
import {
  normalizeRunConfigurationDefinitions,
  type RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'

export type RunConfigurationType = RunConfigurationDefinition['type']
export type DebugTargetKind = DebugLaunchTarget['kind']

export const DEBUG_TARGET_KINDS: DebugTargetKind[] = [
  'python-file',
  'python-module',
  'node-file',
  'node-script',
  'dotnet-project',
  'dotnet-program'
]

function uniqueName(base: string, drafts: readonly RunConfigurationDefinition[]): string {
  const taken = new Set(drafts.map((draft) => draft.name))
  if (!taken.has(base)) {
    return base
  }
  let index = 2
  while (taken.has(`${base} (${index})`)) {
    index += 1
  }
  return `${base} (${index})`
}

export function emptyDebugTarget(kind: DebugTargetKind): DebugLaunchTarget {
  switch (kind) {
    case 'python-file':
      return { kind, filePath: '' }
    case 'python-module':
      return { kind, module: '' }
    case 'node-file':
      return { kind, filePath: '' }
    case 'node-script':
      return { kind, packageManager: 'npm', script: '' }
    case 'dotnet-project':
      return { kind, projectFile: '' }
    case 'dotnet-program':
      return { kind, program: '' }
  }
}

export function newConfiguration(
  type: RunConfigurationType,
  drafts: readonly RunConfigurationDefinition[],
  createId: () => string
): RunConfigurationDefinition {
  const base = { id: createId(), name: uniqueName('Unnamed', drafts) }
  switch (type) {
    case 'command':
      return { type, ...base, command: '' }
    case 'debug':
      return { type, ...base, target: emptyDebugTarget('python-file') }
    case 'compound':
      return { type, ...base, configurations: [] }
  }
}

export function duplicateConfiguration(
  original: RunConfigurationDefinition,
  drafts: readonly RunConfigurationDefinition[],
  createId: () => string
): RunConfigurationDefinition {
  return { ...original, id: createId(), name: uniqueName(`${original.name} (copy)`, drafts) }
}

/** One argument per line, so arguments with spaces need no quoting. */
export function parseArgs(text: string): string[] | undefined {
  const args = text.split('\n').filter((line) => line.trim().length > 0)
  return args.length > 0 ? args : undefined
}

export function formatArgs(args: readonly string[] | undefined): string {
  return (args ?? []).join('\n')
}

export function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const separator = line.indexOf('=')
    const name = separator > 0 ? line.slice(0, separator).trim() : ''
    if (name) {
      env[name] = line.slice(separator + 1)
    }
  }
  return Object.keys(env).length > 0 ? env : undefined
}

export function formatEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')
}

/** Configurations another one may reference (Before launch steps or compound members). */
export function referenceCandidates(
  drafts: readonly RunConfigurationDefinition[],
  ownerId: string,
  types: readonly RunConfigurationType[]
): RunConfigurationDefinition[] {
  return drafts.filter((draft) => draft.id !== ownerId && types.includes(draft.type))
}

export type DraftValidation =
  | { ok: true; configurations: RunConfigurationDefinition[] }
  | { ok: false; messages: string[] }

export function validateDrafts(drafts: readonly RunConfigurationDefinition[]): DraftValidation {
  const { configurations, problems } = normalizeRunConfigurationDefinitions(drafts)
  return problems.length > 0
    ? { ok: false, messages: problems.map((problem) => problem.message) }
    : { ok: true, configurations }
}
