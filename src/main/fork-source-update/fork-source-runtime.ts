import { existsSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { runProcess, spawnProcess } from '../../shared/child-process/run-process'
import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'
import type { ForkSourceIdentity } from './fork-source-identity'
import type { ForkSyncRunResult } from './fork-source-updater'
import { OutputTail, parseForkSyncEventLine, type ForkSyncEvent } from './fork-sync-events'

const LS_REMOTE_TIMEOUT_MS = 60_000
const OUTPUT_TAIL_LINES = 40
const SYNC_SCRIPT = path.join('config', 'scripts', 'fork-maintenance', 'sync-upstream.mjs')

/** `git ls-remote --tags --refs <upstream>` from the source checkout, with the user's shell env. */
export async function listUpstreamTags(identity: ForkSourceIdentity): Promise<string> {
  const result = await runProcess({
    program: 'git',
    args: ['ls-remote', '--tags', '--refs', identity.upstreamRemote],
    cwd: identity.repoRoot,
    // Why the login shell env: a Finder-launched app lacks the terminal's PATH and credential helpers.
    env: await resolveLoginShellEnvironment(),
    timeoutMs: LS_REMOTE_TIMEOUT_MS
  })
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ls-remote exited with ${result.code}`)
  }
  return result.stdout
}

/** Runs the sync script in app mode, streaming its events; resolves when it exits. */
export async function runForkSync(
  identity: ForkSourceIdentity,
  targetTag: string,
  onEvent: (event: ForkSyncEvent) => void
): Promise<ForkSyncRunResult> {
  const scriptPath = path.join(identity.repoRoot, SYNC_SCRIPT)
  if (!existsSync(scriptPath)) {
    throw new Error(
      `${SYNC_SCRIPT} is missing in ${identity.repoRoot}. Check out a branch based on ${identity.branch} there.`
    )
  }
  const tail = new OutputTail(OUTPUT_TAIL_LINES)
  const child = spawnProcess({
    program: 'node',
    args: [scriptPath, targetTag, '--push', '--build', '--auto-worktree', '--events'],
    cwd: identity.repoRoot,
    env: await resolveLoginShellEnvironment(),
    // Why no timeout: install + typecheck + packaging legitimately takes many minutes.
    timeoutMs: null
  })
  const readLines = (stream: NodeJS.ReadableStream): Promise<void> =>
    new Promise((resolve) => {
      const lines = createInterface({ input: stream })
      lines.on('line', (line) => {
        const event = parseForkSyncEventLine(line)
        if (event) {
          onEvent(event)
        } else {
          tail.push(line)
        }
      })
      lines.on('close', resolve)
    })
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
  const [code] = await Promise.all([exit, readLines(child.stdout), readLines(child.stderr)])
  return { code, outputTail: tail.toString() }
}
