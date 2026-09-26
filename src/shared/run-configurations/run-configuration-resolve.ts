import type { DebugLaunchOptions, DebugLaunchTarget } from '../debug/debug-session-types'
import type { CommandRunConfiguration, DebugRunConfiguration } from './run-configuration-definition'
import {
  expandRunConfigurationVariables,
  resolveRunConfigurationPath,
  type RunConfigurationVariableContext
} from './run-configuration-variables'

export type Resolved<T> = { ok: true; value: T } | { ok: false; variable: string }

export type ResolvedCommandLaunch = { command: string; cwd: string }

export type ResolvedDebugLaunch = {
  target: DebugLaunchTarget
  cwd: string
  launchOptions?: DebugLaunchOptions
}

class UnresolvedVariable extends Error {
  constructor(readonly variable: string) {
    super(`Cannot resolve ${variable}`)
  }
}

function expand(
  text: string,
  context: RunConfigurationVariableContext,
  options: { shell?: boolean } = {}
): string {
  const result = expandRunConfigurationVariables(text, context, options)
  if (!result.ok) {
    throw new UnresolvedVariable(result.variable)
  }
  return result.value
}

function path(text: string, context: RunConfigurationVariableContext): string {
  const result = resolveRunConfigurationPath(text, context)
  if (!result.ok) {
    throw new UnresolvedVariable(result.variable)
  }
  return result.value
}

function resolving<T>(build: () => T): Resolved<T> {
  try {
    return { ok: true, value: build() }
  } catch (error) {
    if (error instanceof UnresolvedVariable) {
      return { ok: false, variable: error.variable }
    }
    throw error
  }
}

function resolveTarget(
  target: DebugLaunchTarget,
  context: RunConfigurationVariableContext
): DebugLaunchTarget {
  switch (target.kind) {
    case 'python-file':
      return {
        kind: 'python-file',
        filePath: path(target.filePath, context),
        ...(target.pythonPath ? { pythonPath: path(target.pythonPath, context) } : {})
      }
    case 'python-module':
      return target.pythonPath
        ? { ...target, pythonPath: path(target.pythonPath, context) }
        : target
    case 'node-file':
      return { kind: 'node-file', filePath: path(target.filePath, context) }
    case 'node-script':
      return target
    case 'dotnet-project':
      return { ...target, projectFile: path(target.projectFile, context) }
    case 'dotnet-program':
      return { kind: 'dotnet-program', program: path(target.program, context) }
  }
}

export function resolveCommandLaunch(
  configuration: CommandRunConfiguration,
  context: RunConfigurationVariableContext
): Resolved<ResolvedCommandLaunch> {
  return resolving(() => ({
    command: expand(configuration.command, context, { shell: true }),
    cwd: path(configuration.cwd ?? '.', context)
  }))
}

export function resolveDebugLaunch(
  configuration: DebugRunConfiguration,
  context: RunConfigurationVariableContext
): Resolved<ResolvedDebugLaunch> {
  return resolving(() => {
    const args = configuration.args?.map((arg) => expand(arg, context))
    const env = configuration.env
      ? Object.fromEntries(
          Object.entries(configuration.env).map(([name, value]) => [name, expand(value, context)])
        )
      : undefined
    return {
      target: resolveTarget(configuration.target, context),
      cwd: path(configuration.cwd ?? '.', context),
      ...(args || env
        ? { launchOptions: { ...(args ? { args } : {}), ...(env ? { env } : {}) } }
        : {})
    }
  })
}
