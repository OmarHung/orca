import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runProcess, spawnProcess } from '../../../shared/child-process/run-process'
import { DebugPreparationError } from './prepared-debug-adapter'

const WHERE_TIMEOUT_MS = 15_000
const LEGACY_TFM = /"tfm"\s*:\s*"(netcoreapp\d|net5\.0)/
const FRAMEWORK_MAJOR = /"name"\s*:\s*"Microsoft\.NETCore\.App"\s*,\s*"version"\s*:\s*"(\d+)\./

export type NetcoredbgTarget = { projectFile: string; launchProfile?: string } | { program: string }

/** True when a built program's runtimeconfig names a framework older than .NET 6. */
export function isLegacyRuntimeConfig(text: string | null): boolean {
  if (!text) {
    return false
  }
  if (LEGACY_TFM.test(text)) {
    return true
  }
  const major = FRAMEWORK_MAJOR.exec(text)?.[1]
  return major !== undefined && Number(major) < 6
}

/** Whether the target runs in the container; a project asks the launcher, the one rule source. */
export async function runsInDotnetContainer(
  launcher: string,
  target: NetcoredbgTarget
): Promise<boolean> {
  if ('projectFile' in target) {
    const result = await runProcess({
      program: launcher,
      args: ['--orca-where', target.projectFile],
      cwd: dirname(target.projectFile),
      timeoutMs: WHERE_TIMEOUT_MS
    })
    return result.code === 0 && result.stdout.trim() === 'container'
  }
  // Why strip, not replace: an apphost has no extension, and its runtimeconfig sits beside it.
  const runtimeConfig = `${target.program.replace(/\.(dll|exe)$/i, '')}.runtimeconfig.json`
  return isLegacyRuntimeConfig(await readFile(runtimeConfig, 'utf8').catch(() => null))
}

/**
 * Creates or starts the container (and its image) before the adapter is spawned, streaming any
 * build to the console: the adapter's initialize request would time out waiting for it.
 */
export function ensureDotnetContainer(
  launcher: string,
  cwd: string,
  onOutput: (text: string) => void
): Promise<void> {
  const child = spawnProcess({
    program: launcher,
    args: ['--orca-ensure'],
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => onOutput(chunk.toString('utf8')))
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stderr = (stderr + text).slice(-2_000)
    onOutput(text)
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const reason = stderr.trim().split('\n').at(-1) || `exit ${code ?? 'signal'}`
      reject(new DebugPreparationError(`Could not prepare the .NET container: ${reason}`))
    })
  })
}
