import {
  getRuntimePathBasename,
  isWindowsAbsolutePathLike,
  relativePathInsideRoot
} from '../cross-platform-path'
import { isWslUncPath } from '../wsl-paths'
import { joinProjectPath } from './project-path'
import { quoteShellArgument, type DetectedRunConfiguration } from './run-configuration-types'

const DOCKERFILE = /^(?:dockerfile(?:\.(.+))?|(.+)\.dockerfile)$/i
const PORT = /^(\d+(?:-\d+)?)(?:\/(tcp|udp|sctp))?$/i
const HEREDOC = /<<-?\s*["']?(\w+)["']?/
const HEREDOC_INSTRUCTIONS = new Set(['RUN', 'COPY', 'ADD'])

type Instruction = { keyword: string; args: string }

type Stage = { name: string | null; base: string; ports: string[]; runs: boolean }

/** The part that tells variants apart: `dev` for `Dockerfile.dev` and `dev.Dockerfile`. */
function variantOf(name: string): string | null {
  const match = DOCKERFILE.exec(name)
  return match ? (match[1] ?? match[2] ?? null) : null
}

export function isDockerfile(name: string): boolean {
  // Why: `Dockerfile.dockerignore` is the ignore file for `Dockerfile`, not a build file.
  return DOCKERFILE.test(name) && variantOf(name)?.toLowerCase() !== 'dockerignore'
}

/** Instructions with continuation lines joined; comments and heredoc bodies are dropped. */
function instructionsOf(text: string): Instruction[] {
  const instructions: Instruction[] = []
  let pending = ''
  let heredocEnd: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (heredocEnd !== null) {
      heredocEnd = line === heredocEnd ? null : heredocEnd
      continue
    }
    // Why blank lines too: Docker skips them inside a continued instruction.
    if (!line || line.startsWith('#')) {
      continue
    }
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1)} `
      continue
    }
    const full = `${pending}${line}`.trim()
    pending = ''
    const space = full.search(/\s/)
    if (space > 0) {
      const keyword = full.slice(0, space).toUpperCase()
      const args = full.slice(space + 1).trim()
      instructions.push({ keyword, args })
      heredocEnd = HEREDOC_INSTRUCTIONS.has(keyword) ? (HEREDOC.exec(args)?.[1] ?? null) : null
    }
  }
  return instructions
}

function wordsOf(args: string): string[] {
  if (args.startsWith('[')) {
    try {
      const value: unknown = JSON.parse(args)
      if (Array.isArray(value)) {
        return value.filter((word): word is string => typeof word === 'string')
      }
    } catch {
      // Not JSON after all; fall back to plain words.
    }
  }
  return args.split(/\s+/).filter(Boolean)
}

function stagesOf(instructions: readonly Instruction[]): Stage[] {
  const stages: Stage[] = []
  for (const { keyword, args } of instructions) {
    if (keyword === 'FROM') {
      const [base = '', as, name] = wordsOf(args).filter((word) => !word.startsWith('--'))
      stages.push({
        base: base.toLowerCase(),
        name: as?.toLowerCase() === 'as' && name ? name.toLowerCase() : null,
        ports: [],
        runs: false
      })
    } else if (keyword === 'EXPOSE') {
      stages.at(-1)?.ports.push(...wordsOf(args))
    } else if (keyword === 'CMD' || keyword === 'ENTRYPOINT') {
      const stage = stages.at(-1)
      if (stage) {
        stage.runs = true
      }
    }
  }
  return stages
}

// Why scratch without CMD: such a stage only holds files for `docker build -o`; it cannot run.
function isExportStage(stage: Stage): boolean {
  return stage.base === 'scratch' && !stage.runs
}

/** Named stages that only hold files to export, e.g. `FROM scratch AS export-web`. */
export function dockerExportStages(text: string): string[] {
  return stagesOf(instructionsOf(text))
    .filter(isExportStage)
    .flatMap((stage) => (stage.name ? [stage.name] : []))
}

/** `-p` flags for the ports the final stage exposes, including those of stages it builds on. */
function publishFlags(stages: readonly Stage[]): string[] {
  const chain: Stage[] = []
  let stage = stages.at(-1)
  while (stage && !chain.includes(stage)) {
    chain.unshift(stage)
    const base = stage.base
    stage = stages.find((candidate) => candidate.name === base)
  }
  const flags = chain.flatMap((member) =>
    member.ports.flatMap((port) => {
      const match = PORT.exec(port)
      if (!match) {
        return []
      }
      const protocol = match[2]?.toLowerCase()
      const suffix = protocol && protocol !== 'tcp' ? `/${protocol}` : ''
      return [`-p ${match[1]}:${match[1]}${suffix}`]
    })
  )
  return [...new Set(flags)]
}

/** Paths COPY and ADD read from the build context (not from another stage or a URL). */
function contextSources(instructions: readonly Instruction[]): string[] {
  return instructions
    .filter(({ keyword }) => keyword === 'COPY' || keyword === 'ADD')
    .flatMap(({ args }) => {
      const words = wordsOf(args)
      if (words.some((word) => word.startsWith('--from='))) {
        return []
      }
      return words
        .filter((word) => !word.startsWith('--'))
        .slice(0, -1)
        .filter((word) => !word.startsWith('<<') && !/^[a-z]+:\/\//i.test(word))
        .map((word) => word.replace(/\\/g, '/').replace(/^\.\//, ''))
    })
}

/**
 * How many folders above the Dockerfile the build context is. Visual Studio's Dockerfiles build
 * from the solution folder, so `src/Api/Dockerfile` copies `src/Api/Api.csproj`: a copied path
 * that starts with the Dockerfile's own folders names the context they are relative to.
 */
function contextLevelsUp(projectDir: string, workspaceRoot: string, sources: string[]): number {
  const relative = relativePathInsideRoot(workspaceRoot, projectDir) ?? ''
  const folders = relative.split(/[\\/]+/).filter(Boolean)
  for (let up = folders.length; up > 0; up -= 1) {
    const prefix = folders.slice(-up).join('/')
    if (sources.some((source) => source === prefix || source.startsWith(`${prefix}/`))) {
      return up
    }
  }
  return 0
}

/** A valid image name from a folder name: lowercase letters and digits joined by dashes. */
function imageNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function imageName(projectDir: string, fileName: string): string {
  const folder = imageNamePart(getRuntimePathBasename(projectDir)) || 'app'
  const variant = imageNamePart(variantOf(fileName) ?? '')
  return variant ? `${folder}-${variant}` : folder
}

function ancestorDir(path: string, levels: number): string {
  let dir = path
  for (let level = 0; level < levels; level += 1) {
    dir = dir.replace(/[\\/]+[^\\/]+[\\/]*$/, '')
  }
  return dir
}

/** Commands are chained with `&&`, which Windows PowerShell 5.1 cannot parse. */
function mayChainCommands(projectDir: string): boolean {
  return !isWindowsAbsolutePathLike(projectDir) || isWslUncPath(projectDir)
}

/**
 * Build and Run for a Dockerfile: the image is named after the folder, the build context is found
 * from what the file copies, and Run publishes the exposed ports (building first where the shell
 * can chain commands).
 */
export function detectDockerfileRunConfigurations(options: {
  projectDir: string
  workspaceRoot: string
  fileName: string
  text: string
}): DetectedRunConfiguration[] {
  const { projectDir, fileName } = options
  const quotedFile = quoteShellArgument(fileName)
  if (quotedFile === null) {
    return []
  }
  const instructions = instructionsOf(options.text)
  const stages = stagesOf(instructions)
  const levelsUp = contextLevelsUp(projectDir, options.workspaceRoot, contextSources(instructions))
  const context = levelsUp === 0 ? '.' : Array.from({ length: levelsUp }, () => '..').join('/')
  const image = imageName(projectDir, fileName)
  const fileFlag = fileName === 'Dockerfile' && context === '.' ? '' : `-f ${quotedFile} `
  const build = `docker build ${fileFlag}-t ${image} ${context}`
  const run = ['docker run --rm -it', ...publishFlags(stages), image].join(' ')
  const exportStages = dockerExportStages(options.text)
  const base = {
    ecosystem: 'docker' as const,
    projectName: fileName,
    projectDir,
    projectFile: joinProjectPath(projectDir, fileName)
  }
  const finalStage = stages.at(-1)
  const runnable = finalStage !== undefined && !isExportStage(finalStage)
  return [
    ...(runnable
      ? [
          {
            ...base,
            id: `docker:${projectDir}:dockerfile:${fileName}:run`,
            kind: 'run' as const,
            name: 'run',
            command: mayChainCommands(projectDir) ? `${build} && ${run}` : run
          }
        ]
      : []),
    {
      ...base,
      id: `docker:${projectDir}:dockerfile:${fileName}:build`,
      kind: 'build',
      name: 'build',
      command: build,
      ...(exportStages.length > 0
        ? { dockerExport: { contextDir: ancestorDir(projectDir, levelsUp), stages: exportStages } }
        : {})
    }
  ]
}
