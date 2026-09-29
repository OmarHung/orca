import type { CommandRunConfiguration } from './run-configuration-definition'
import { quoteShellArgument } from './run-configuration-types'
import { asText } from './run-configuration-values'

/** Rider's "Publish to folder": `dotnet publish` run from the workspace root. */
export type DotnetPublishRunConfiguration = {
  type: 'dotnet-publish'
  id: string
  name: string
  /** Relative to the workspace root, or absolute. */
  projectFile: string
  /** Target location, relative to the workspace root; unset keeps the SDK's bin/…/publish. */
  outputDir?: string
  /** MSBuild configuration, Release when unset. */
  buildConfiguration?: string
  /** Target framework; needed when the project targets several. */
  framework?: string
  /** Runtime identifier; unset publishes a portable app. */
  runtime?: string
  selfContained?: boolean
  singleFile?: boolean
  readyToRun?: boolean
  trimmed?: boolean
  /** Appended to the command line as written. */
  extraArgs?: string
  beforeLaunch?: string[]
}

export const DOTNET_PROJECT_FILE_PATTERN = /\.(cs|fs|vb)proj$/i
// Why: configuration, framework and runtime names go onto the command line unquoted.
const MSBUILD_NAME_PATTERN = /^[A-Za-z0-9_.+-]{1,100}$/

export const DEFAULT_PUBLISH_BUILD_CONFIGURATION = 'Release'

/** The target runtimes Rider offers; other RIDs can still be written in orca.yaml. */
export const DOTNET_PUBLISH_RUNTIMES = [
  'win-x64',
  'win-x86',
  'win-arm64',
  'linux-x64',
  'linux-arm64',
  'linux-musl-x64',
  'linux-musl-arm64',
  'osx-x64',
  'osx-arm64'
] as const

export function normalizeDotnetPublish(
  record: Record<string, unknown>,
  base: { id: string; name: string; beforeLaunch?: string[] }
): DotnetPublishRunConfiguration | string {
  const projectFile = asText(record.projectFile)
  if (!projectFile || !DOTNET_PROJECT_FILE_PATTERN.test(projectFile)) {
    return `"${base.name}": choose the .csproj, .fsproj or .vbproj file to publish.`
  }
  const buildConfiguration = asText(record.buildConfiguration)
  const framework = asText(record.framework)
  const runtime = asText(record.runtime)
  const invalid = [buildConfiguration, framework, runtime].find(
    (value) => value !== undefined && !MSBUILD_NAME_PATTERN.test(value)
  )
  if (invalid) {
    return `"${base.name}": "${invalid}" is not a valid configuration, framework or runtime.`
  }
  const outputDir = asText(record.outputDir)
  const unquotable = [projectFile, outputDir].find(
    (value) => value !== undefined && quoteShellArgument(value) === null
  )
  if (unquotable) {
    return `"${base.name}": the path "${unquotable}" contains characters that cannot be passed safely to a shell, such as " $ \` % or !.`
  }
  const extraArgs = asText(record.extraArgs)
  return {
    type: 'dotnet-publish',
    id: base.id,
    name: base.name,
    projectFile,
    ...(outputDir ? { outputDir } : {}),
    ...(buildConfiguration ? { buildConfiguration } : {}),
    ...(framework ? { framework } : {}),
    ...(runtime ? { runtime } : {}),
    ...(record.selfContained === true ? { selfContained: true } : {}),
    ...(record.singleFile === true ? { singleFile: true } : {}),
    ...(record.readyToRun === true ? { readyToRun: true } : {}),
    ...(record.trimmed === true ? { trimmed: true } : {}),
    ...(extraArgs ? { extraArgs } : {}),
    ...(base.beforeLaunch ? { beforeLaunch: base.beforeLaunch } : {})
  }
}

/**
 * The `dotnet publish` command line; it runs from the workspace root, so relative paths resolve
 * there. Null when a path cannot be quoted safely (normalizeDotnetPublish rejects those).
 */
export function dotnetPublishCommand(configuration: DotnetPublishRunConfiguration): string | null {
  const projectFile = quoteShellArgument(configuration.projectFile)
  const outputDir =
    configuration.outputDir === undefined ? undefined : quoteShellArgument(configuration.outputDir)
  if (projectFile === null || outputDir === null) {
    return null
  }
  const args = [
    'dotnet',
    'publish',
    projectFile,
    '-c',
    configuration.buildConfiguration ?? DEFAULT_PUBLISH_BUILD_CONFIGURATION
  ]
  if (configuration.framework) {
    args.push('-f', configuration.framework)
  }
  // Why only with a runtime: self-contained, single-file and ReadyToRun all need a RID.
  if (configuration.runtime) {
    args.push('-r', configuration.runtime)
    args.push('--self-contained', configuration.selfContained ? 'true' : 'false')
    if (configuration.singleFile) {
      args.push('-p:PublishSingleFile=true')
    }
    if (configuration.readyToRun) {
      args.push('-p:PublishReadyToRun=true')
    }
    if (configuration.selfContained && configuration.trimmed) {
      args.push('-p:PublishTrimmed=true')
    }
  }
  if (outputDir) {
    args.push('-o', outputDir)
  }
  if (configuration.extraArgs) {
    args.push(configuration.extraArgs)
  }
  return args.join(' ')
}

/** Publishing is a terminal command, so it runs, waits and stops like any command configuration. */
export function dotnetPublishAsCommand(
  configuration: DotnetPublishRunConfiguration
): CommandRunConfiguration | null {
  const command = dotnetPublishCommand(configuration)
  if (command === null) {
    return null
  }
  return {
    type: 'command',
    id: configuration.id,
    name: configuration.name,
    command,
    ...(configuration.beforeLaunch ? { beforeLaunch: configuration.beforeLaunch } : {})
  }
}

function joinRelative(...segments: string[]): string {
  const separator = segments.some((segment) => segment.includes('\\')) ? '\\' : '/'
  return segments
    .map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean)
    .join(separator)
}

/** A new folder publish for a project, targeting `bin/Release/<tfm>/publish` like Rider. */
export function newDotnetPublishConfiguration(options: {
  id: string
  projectName: string
  /** Workspace-relative project file and its folder. */
  projectFile: string
  projectDir: string
  targetFrameworks: readonly string[]
}): DotnetPublishRunConfiguration {
  const [framework] = options.targetFrameworks
  return {
    type: 'dotnet-publish',
    id: options.id,
    name: `Publish ${options.projectName} to folder`,
    projectFile: options.projectFile,
    outputDir: joinRelative(
      options.projectDir,
      'bin',
      DEFAULT_PUBLISH_BUILD_CONFIGURATION,
      framework ?? '',
      'publish'
    ),
    buildConfiguration: DEFAULT_PUBLISH_BUILD_CONFIGURATION,
    // Why: publishing a multi-targeted project fails unless one framework is chosen.
    ...(options.targetFrameworks.length > 1 && framework ? { framework } : {})
  }
}
