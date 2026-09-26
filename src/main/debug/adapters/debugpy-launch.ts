import { isExecutableFile, resolvePythonInterpreter } from '../../python/python-interpreters'
import { startStdioDapTransport } from '../dap-transport-stdio'
import { ensureDebugAdapterInstalled } from './adapter-installer'
import { DEBUGPY_ARTIFACT } from './adapter-manifest'
import {
  buildDebugpyAdapterSpawn,
  buildDebugpyLaunchArguments,
  createDebugpyInstallDeps
} from './debugpy-adapter'
import {
  DebugPreparationError,
  type AdapterPreparation,
  type PreparedDebugAdapter
} from './prepared-debug-adapter'

const MAX_STDERR_CHARS = 4_000

export async function prepareDebugpy(
  context: AdapterPreparation,
  target: { filePath: string; pythonPath?: string }
): Promise<PreparedDebugAdapter> {
  if (target.pythonPath && !(await isExecutableFile(target.pythonPath))) {
    throw new DebugPreparationError(`Python interpreter not found: ${target.pythonPath}`)
  }
  const pythonPath = target.pythonPath ?? (await resolvePythonInterpreter(context.cwd))
  if (!pythonPath) {
    throw new DebugPreparationError(
      'No Python interpreter found (looked for .venv, venv, then python3 on PATH)'
    )
  }
  context.onInstalling()
  const debugpyDir = await ensureDebugAdapterInstalled(
    DEBUGPY_ARTIFACT,
    context.adaptersDir,
    createDebugpyInstallDeps(pythonPath)
  )
  let stderr = ''
  const transport = startStdioDapTransport({
    ...buildDebugpyAdapterSpawn(pythonPath, debugpyDir),
    cwd: context.cwd,
    onStderr: (text) => {
      stderr = (stderr + text).slice(-MAX_STDERR_CHARS)
    }
  })
  return {
    adapterId: 'debugpy',
    transport,
    launchArguments: buildDebugpyLaunchArguments({
      filePath: target.filePath,
      cwd: context.cwd,
      pythonPath
    }),
    diagnostics: () => stderr.trim(),
    dispose: () => {}
  }
}
