import type { CommandRunConfiguration } from './run-configuration-definition'
import { quoteShellArgument } from './run-configuration-types'
import { asText } from './run-configuration-values'

/** Exports a Dockerfile stage's files to a folder: `docker build --target <stage> -o <folder>`. */
export type DockerExportRunConfiguration = {
  type: 'docker-export'
  id: string
  name: string
  /** Relative to the workspace root, or absolute. */
  dockerfile: string
  /** Build context, relative to the workspace root or absolute; the Dockerfile's folder when unset. */
  context?: string
  /** The stage whose files are exported. */
  target: string
  /** Relative to the workspace root, or absolute. */
  outputDir: string
  /**
   * Empty the folder first: `docker build -o` adds and overwrites files but never removes any.
   * POSIX shells run `rm -rf` before the build; on Windows the launcher deletes it.
   */
  cleanOutputDir?: boolean
  /** Appended to the command line as written. */
  extraArgs?: string
  beforeLaunch?: string[]
}

// Docker's own rule for stage names, so the name goes onto the command line unquoted.
const STAGE_NAME_PATTERN = /^[A-Za-z][\w.-]{0,127}$/

function parentFolder(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : index === 0 ? path.slice(0, 1) : '.'
}

/** The build context the command passes; the Dockerfile's folder unless one is set. */
export function dockerExportContext(configuration: DockerExportRunConfiguration): string {
  return configuration.context || parentFolder(configuration.dockerfile)
}

function sameRelativePath(a: string, b: string): boolean {
  const normalize = (path: string): string =>
    path
      .replace(/\\/g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/\/+$/, '')
  return normalize(a) === normalize(b)
}

export function normalizeDockerExport(
  record: Record<string, unknown>,
  base: { id: string; name: string; beforeLaunch?: string[] }
): DockerExportRunConfiguration | string {
  const dockerfile = asText(record.dockerfile)
  if (!dockerfile) {
    return `"${base.name}": choose the Dockerfile to build.`
  }
  const target = asText(record.target)
  if (!target || !STAGE_NAME_PATTERN.test(target)) {
    return `"${base.name}": choose the stage to export.`
  }
  const outputDir = asText(record.outputDir)
  if (!outputDir) {
    return `"${base.name}": choose the folder to export to.`
  }
  // Why: Docker reads a comma in `-o` as the start of another export option.
  if (outputDir.includes(',')) {
    return `"${base.name}": the output folder cannot contain a comma.`
  }
  const context = asText(record.context)
  const unquotable = [dockerfile, context, outputDir].find(
    (value) => value !== undefined && quoteShellArgument(value) === null
  )
  if (unquotable) {
    return `"${base.name}": the path "${unquotable}" contains characters that cannot be passed safely to a shell, such as " $ \` % or !.`
  }
  const extraArgs = asText(record.extraArgs)
  return {
    type: 'docker-export',
    id: base.id,
    name: base.name,
    dockerfile,
    ...(context ? { context } : {}),
    target,
    outputDir,
    ...(record.cleanOutputDir === true ? { cleanOutputDir: true } : {}),
    ...(extraArgs ? { extraArgs } : {}),
    ...(base.beforeLaunch ? { beforeLaunch: base.beforeLaunch } : {})
  }
}

export type DockerExportCommandOptions = {
  /** The workspace's shell has `rm` and `&&` (see runsPosixShell); otherwise Orca empties it. */
  posixShell: boolean
}

/**
 * The `docker build` command line (after `rm -rf` of the output folder when it is emptied in a
 * POSIX shell); it runs from the workspace root, so relative paths resolve there. Null when a path
 * cannot be passed safely (normalizeDockerExport rejects those).
 */
export function dockerExportCommand(
  configuration: DockerExportRunConfiguration,
  options: DockerExportCommandOptions
): string | null {
  const context = dockerExportContext(configuration)
  const quoted = [configuration.dockerfile, context, configuration.outputDir].map(
    quoteShellArgument
  )
  const [dockerfile, quotedContext, outputDir] = quoted
  if (
    dockerfile === null ||
    quotedContext === null ||
    outputDir === null ||
    configuration.outputDir.includes(',') ||
    !STAGE_NAME_PATTERN.test(configuration.target)
  ) {
    return null
  }
  // Why: `<context>/Dockerfile` is Docker's default, so the usual command stays as people write it.
  const isDefaultFile = sameRelativePath(configuration.dockerfile, `${context}/Dockerfile`)
  return [
    ...(configuration.cleanOutputDir && options.posixShell ? [`rm -rf ${outputDir} &&`] : []),
    'docker build',
    ...(isDefaultFile ? [] : [`-f ${dockerfile}`]),
    `--target ${configuration.target}`,
    `-o ${outputDir}`,
    ...(configuration.extraArgs ? [configuration.extraArgs] : []),
    quotedContext
  ].join(' ')
}

/** Exporting is a terminal command, so it runs, waits and stops like any command configuration. */
export function dockerExportAsCommand(
  configuration: DockerExportRunConfiguration,
  options: DockerExportCommandOptions
): CommandRunConfiguration | null {
  const command = dockerExportCommand(configuration, options)
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

/** A new export of one stage, into `publish/<stage>` until a folder is chosen, emptied first. */
export function newDockerExportConfiguration(options: {
  id: string
  /** Workspace-relative Dockerfile and build context. */
  dockerfile: string
  context: string
  target: string
}): DockerExportRunConfiguration {
  return {
    type: 'docker-export',
    id: options.id,
    name: `Export ${options.target} to folder`,
    dockerfile: options.dockerfile,
    context: options.context,
    target: options.target,
    outputDir: `publish/${options.target}`,
    cleanOutputDir: true
  }
}
