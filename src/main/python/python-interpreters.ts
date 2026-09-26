import { access, constants as fsConstants, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type {
  PythonInterpreter,
  PythonInterpreterSource
} from '../../shared/python-interpreter-types'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'

const VENV_DIR_NAMES = ['.venv', 'venv', 'env']
const PROBE_TIMEOUT_MS = 5_000
const VERSION_PATTERN = /Python\s+(\d+\.\d+(?:\.\d+)?\S*)/

type Candidate = { path: string; source: PythonInterpreterSource; envName?: string }

export type InterpreterDetectionDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** Runs a probe and returns its combined output, or null if it failed. */
  probe: (program: string, args: string[], cwd: string) => Promise<string | null>
}

async function defaultProbe(program: string, args: string[], cwd: string): Promise<string | null> {
  try {
    const result = await runProcess({ program, args, cwd, timeoutMs: PROBE_TIMEOUT_MS })
    return result.code === 0 ? `${result.stdout}\n${result.stderr}` : null
  } catch {
    return null
  }
}

export const DEFAULT_INTERPRETER_DETECTION_DEPS: InterpreterDetectionDeps = {
  platform: process.platform,
  env: process.env,
  probe: defaultProbe
}

export function venvInterpreterPath(
  envDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32'
    ? join(envDir, 'Scripts', 'python.exe')
    : join(envDir, 'bin', 'python')
}

export async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function venvCandidates(root: string, deps: InterpreterDetectionDeps): Promise<Candidate[]> {
  const found: Candidate[] = []
  for (const envName of VENV_DIR_NAMES) {
    const path = venvInterpreterPath(join(root, envName), deps.platform)
    if (await isExecutableFile(path)) {
      found.push({ path, source: 'venv', envName })
    }
  }
  return found
}

async function poetryCandidate(
  root: string,
  deps: InterpreterDetectionDeps
): Promise<Candidate | null> {
  if (!(await exists(join(root, 'poetry.lock')))) {
    return null
  }
  const poetry = await resolveCommandOnLocalPath('poetry', {
    platform: deps.platform,
    env: deps.env,
    cwd: root
  })
  if (!poetry) {
    return null
  }
  const envDir = (await deps.probe(poetry, ['env', 'info', '--path'], root))?.trim().split('\n')[0]
  if (!envDir || !isAbsolute(envDir)) {
    return null
  }
  const path = venvInterpreterPath(envDir, deps.platform)
  return (await isExecutableFile(path)) ? { path, source: 'poetry' } : null
}

async function pathCandidates(root: string, deps: InterpreterDetectionDeps): Promise<Candidate[]> {
  const names = deps.platform === 'win32' ? ['python'] : ['python3', 'python']
  const found: Candidate[] = []
  for (const name of names) {
    const path = await resolveCommandOnLocalPath(name, {
      platform: deps.platform,
      env: deps.env,
      cwd: root
    })
    if (path) {
      found.push({ path, source: 'path' })
    }
  }
  return found
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/** Candidates in auto-detection preference order: project venvs, poetry, then PATH. */
async function findCandidates(root: string, deps: InterpreterDetectionDeps): Promise<Candidate[]> {
  const poetry = await poetryCandidate(root, deps)
  const ordered = [
    ...(await venvCandidates(root, deps)),
    ...(poetry ? [poetry] : []),
    ...(await pathCandidates(root, deps))
  ]
  // Why dedupe by real path: `python` and `python3` on PATH are usually the same binary,
  // and poetry's env can be the project's own .venv.
  const seen = new Set<string>()
  const unique: Candidate[] = []
  for (const candidate of ordered) {
    const key = await canonical(candidate.path)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(candidate)
    }
  }
  return unique
}

export async function describeInterpreter(
  candidate: Candidate,
  root: string,
  deps: InterpreterDetectionDeps
): Promise<PythonInterpreter> {
  const output = await deps.probe(candidate.path, ['--version'], root)
  const version = output ? (VERSION_PATTERN.exec(output)?.[1] ?? null) : null
  return { ...candidate, version }
}

/** Every Python interpreter usable for the project at `root`, preferred first. */
export async function detectPythonInterpreters(
  root: string,
  deps: InterpreterDetectionDeps = DEFAULT_INTERPRETER_DETECTION_DEPS
): Promise<PythonInterpreter[]> {
  const candidates = await findCandidates(root, deps)
  return Promise.all(candidates.map((candidate) => describeInterpreter(candidate, root, deps)))
}

/** The interpreter auto-detection picks, without probing versions. */
export async function resolvePythonInterpreter(
  root: string,
  deps: InterpreterDetectionDeps = DEFAULT_INTERPRETER_DETECTION_DEPS
): Promise<string | null> {
  return (await findCandidates(root, deps))[0]?.path ?? null
}
