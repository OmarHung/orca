import { access, constants as fsConstants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { net } from 'electron'
import type { DebugProtocol } from '@vscode/debugprotocol'
import { runProcess } from '../../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../../ipc/command-path-resolver'
import type { AdapterInstallDeps } from './adapter-installer'

const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const EXTRACT_TIMEOUT_MS = 120_000
const VENV_DIR_NAMES = ['.venv', 'venv']

function venvInterpreterPath(root: string, venvDir: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? join(root, venvDir, 'Scripts', 'python.exe')
    : join(root, venvDir, 'bin', 'python')
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Prefers the project's virtualenv, then a Python on PATH. */
export async function resolvePythonInterpreter(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  for (const venvDir of VENV_DIR_NAMES) {
    const candidate = venvInterpreterPath(projectRoot, venvDir, platform)
    if (await isExecutable(candidate)) {
      return candidate
    }
  }
  const names = platform === 'win32' ? ['python'] : ['python3', 'python']
  for (const name of names) {
    const resolved = await resolveCommandOnLocalPath(name, { platform, env, cwd: projectRoot })
    if (resolved) {
      return resolved
    }
  }
  return null
}

export function buildDebugpyAdapterSpawn(
  pythonPath: string,
  debugpyDir: string,
  env: NodeJS.ProcessEnv = process.env
): { program: string; args: string[]; env: NodeJS.ProcessEnv } {
  const existing = env.PYTHONPATH
  return {
    program: pythonPath,
    args: ['-m', 'debugpy.adapter'],
    env: { ...env, PYTHONPATH: existing ? `${debugpyDir}${delimiter}${existing}` : debugpyDir }
  }
}

export function buildDebugpyLaunchArguments(options: {
  filePath: string
  cwd: string
  pythonPath: string
}): DebugProtocol.LaunchRequestArguments & Record<string, unknown> {
  return {
    type: 'debugpy',
    request: 'launch',
    name: 'Orca: Python file',
    program: options.filePath,
    cwd: options.cwd,
    python: [options.pythonPath],
    // Why internalConsole: program output arrives as DAP `output` events for the Debug panel.
    console: 'internalConsole',
    justMyCode: true
  }
}

async function downloadWithElectronNet(url: string): Promise<Buffer> {
  // Why electron net: it honors the system proxy, which plain Node fetch does not.
  const response = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes: ${url}`)
  }
  return bytes
}

/** Wheels are zip files; the interpreter we already need can extract them (and rejects unsafe paths). */
export function createDebugpyInstallDeps(pythonPath: string): AdapterInstallDeps {
  return {
    download: downloadWithElectronNet,
    extract: async (archivePath, destination) => {
      const result = await runProcess({
        program: pythonPath,
        args: ['-m', 'zipfile', '-e', archivePath, destination],
        timeoutMs: EXTRACT_TIMEOUT_MS
      })
      if (result.code !== 0) {
        throw new Error(
          `Extracting debugpy failed: ${result.stderr.trim() || `exit ${result.code}`}`
        )
      }
    }
  }
}
