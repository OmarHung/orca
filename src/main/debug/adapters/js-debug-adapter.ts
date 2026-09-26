import { join } from 'node:path'
import { spawnProcess } from '../../../shared/child-process/run-process'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '../../../shared/child-process/process-tree-termination'
import type { AdapterInstallDeps } from './adapter-installer'
import { extractArchive } from './archive-extract'
import { downloadWithElectronNet } from './adapter-download'

const LISTENING_PATTERN = /listening at ([\d.]+):(\d+)/
const SERVER_START_TIMEOUT_MS = 15_000
const MAX_STARTUP_OUTPUT_CHARS = 4_000

export type JsDebugServer = {
  host: string
  port: number
  dispose: () => void
}

export function createJsDebugInstallDeps(): AdapterInstallDeps {
  return { download: downloadWithElectronNet, extract: extractArchive }
}

/**
 * Starts js-debug's standalone DAP server on a free localhost port. Orca's own runtime runs it
 * (ELECTRON_RUN_AS_NODE), so debugging does not depend on which Node the user installed.
 */
export function startJsDebugServer(
  installDir: string,
  runtime: { program: string; env: NodeJS.ProcessEnv } = {
    program: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
): Promise<JsDebugServer> {
  const child = spawnProcess({
    program: runtime.program,
    args: [join(installDir, 'js-debug', 'src', 'dapDebugServer.js'), '0', '127.0.0.1'],
    env: runtime.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: null
  })
  const dispose = (): void => {
    void signalProcessTree(child, 'SIGTERM')
    setTimeout(() => void forceTerminateProcessTree(child), 3_000).unref?.()
  }
  return new Promise((resolve, reject) => {
    let output = ''
    const fail = (error: Error): void => {
      clearTimeout(timer)
      dispose()
      reject(error)
    }
    const timer = setTimeout(
      () =>
        fail(new Error(`js-debug did not start within ${SERVER_START_TIMEOUT_MS}ms: ${output}`)),
      SERVER_START_TIMEOUT_MS
    )
    const onOutput = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-MAX_STARTUP_OUTPUT_CHARS)
      const match = LISTENING_PATTERN.exec(output)
      if (match) {
        clearTimeout(timer)
        child.stdout.off('data', onOutput)
        resolve({ host: match[1], port: Number(match[2]), dispose })
      }
    }
    child.stdout.on('data', onOutput)
    child.stderr.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-MAX_STARTUP_OUTPUT_CHARS)
    })
    child.on('error', fail)
    child.on('exit', (code) => fail(new Error(`js-debug exited (${code ?? 'signal'}): ${output}`)))
  })
}

export type NodeLaunchTarget =
  | { kind: 'file'; filePath: string }
  | { kind: 'script'; packageManager: string; script: string }

export function buildNodeLaunchArguments(options: {
  target: NodeLaunchTarget
  cwd: string
}): Record<string, unknown> {
  const { target, cwd } = options
  const base = {
    type: 'pwa-node',
    request: 'launch',
    name: 'Orca: Node',
    cwd,
    // Why internalConsole + std capture: program output arrives as DAP `output` events.
    console: 'internalConsole',
    outputCapture: 'std',
    skipFiles: ['<node_internals>/**'],
    // Why: package managers ship without source maps, so looking them up only adds noise.
    resolveSourceMapLocations: [`${cwd}/**`, '!**/node_modules/**']
  }
  if (target.kind === 'file') {
    return { ...base, program: target.filePath }
  }
  // js-debug follows the child node processes the package manager starts.
  return { ...base, runtimeExecutable: target.packageManager, runtimeArgs: ['run', target.script] }
}
