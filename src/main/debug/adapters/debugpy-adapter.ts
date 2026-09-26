import { delimiter } from 'node:path'
import { net } from 'electron'
import type { DebugProtocol } from '@vscode/debugprotocol'
import { runProcess } from '../../../shared/child-process/run-process'
import type { AdapterInstallDeps } from './adapter-installer'

const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const EXTRACT_TIMEOUT_MS = 120_000
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
