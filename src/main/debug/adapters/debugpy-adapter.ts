import { delimiter } from 'node:path'
import type { DebugProtocol } from '@vscode/debugprotocol'
import { runProcess } from '../../../shared/child-process/run-process'
import type { AdapterInstallDeps } from './adapter-installer'
import { downloadWithElectronNet } from './adapter-download'

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

export type DebugpyEntryPoint = { filePath: string } | { module: string }

export function buildDebugpyLaunchArguments(
  options: DebugpyEntryPoint & { cwd: string; pythonPath: string }
): DebugProtocol.LaunchRequestArguments & Record<string, unknown> {
  return {
    type: 'debugpy',
    request: 'launch',
    name: 'Orca: Python',
    ...('module' in options ? { module: options.module } : { program: options.filePath }),
    cwd: options.cwd,
    python: [options.pythonPath],
    // Why internalConsole: program output arrives as DAP `output` events for the Debug panel.
    console: 'internalConsole',
    justMyCode: true
  }
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
