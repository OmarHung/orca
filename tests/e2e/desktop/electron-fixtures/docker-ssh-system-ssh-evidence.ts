import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import type { DockerSshHostTarget } from './docker-ssh-host-target'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Points Orca's system `ssh` at a wrapper that trusts the Docker host's key and logs whether each
 * invocation was a plain transport or a `-L` port forward. Returns the log path.
 */
export async function trustDockerSshHost(
  electronApp: ElectronApplication,
  target: DockerSshHostTarget
): Promise<string> {
  const sshDir = join(target.tempDir, '.ssh')
  mkdirSync(sshDir, { recursive: true })
  const knownHostsPath = join(sshDir, 'known_hosts')
  const hostKeys = execFileSync('ssh-keyscan', ['-p', String(target.port), '127.0.0.1'], {
    encoding: 'utf8'
  })
  writeFileSync(knownHostsPath, hostKeys)
  const invocationLogPath = join(target.tempDir, 'system-ssh-invocations')
  const wrapperPath = join(target.tempDir, 'verified-system-ssh')
  writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      'kind=transport',
      'for arg in "$@"; do',
      '  if [ "$arg" = "-L" ]; then kind=forward; fi',
      'done',
      `printf '%s\\n' "$kind" >> ${shellQuote(invocationLogPath)}`,
      `exec /usr/bin/ssh -o UserKnownHostsFile=${shellQuote(knownHostsPath)} -o StrictHostKeyChecking=yes "$@"`
    ].join('\n')
  )
  chmodSync(wrapperPath, 0o755)
  await electronApp.evaluate((_electron, path) => {
    process.env.ORCA_SYSTEM_SSH_PATH = path
  }, wrapperPath)
  return invocationLogPath
}

export function readSystemSshInvocationKinds(invocationLogPath: string): string[] {
  if (!existsSync(invocationLogPath)) {
    return []
  }
  return readFileSync(invocationLogPath, 'utf8').split(/\r?\n/).filter(Boolean)
}
