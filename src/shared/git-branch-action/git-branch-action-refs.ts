import { isSafeGitRemoteName } from '../git-push-target-validation'
import type { GitBranchActionExecutor } from './git-branch-action-types'

const LOCAL_PREFIX = 'refs/heads/'
const REMOTE_PREFIX = 'refs/remotes/'

export function isLocalBranchRef(ref: string): boolean {
  return ref.startsWith(LOCAL_PREFIX)
}

/** `refs/heads/main` → `main`, `refs/remotes/origin/main` → `origin/main`. */
export function shortBranchName(ref: string): string {
  if (ref.startsWith(LOCAL_PREFIX)) {
    return ref.slice(LOCAL_PREFIX.length)
  }
  return ref.startsWith(REMOTE_PREFIX) ? ref.slice(REMOTE_PREFIX.length) : ref
}

async function succeeds(exec: GitBranchActionExecutor, args: string[]): Promise<boolean> {
  try {
    await exec(args)
    return true
  } catch {
    return false
  }
}

export async function refExists(exec: GitBranchActionExecutor, ref: string): Promise<boolean> {
  return succeeds(exec, ['show-ref', '--verify', '--quiet', ref])
}

export async function requireRef(exec: GitBranchActionExecutor, ref: string): Promise<void> {
  if (!(await refExists(exec, ref))) {
    throw new Error(`Branch ${shortBranchName(ref)} no longer exists. Refresh the log.`)
  }
}

/** Short name for merge messages ("Merge branch 'x'"), unless a same-named tag makes it ambiguous. */
export async function mergeableName(exec: GitBranchActionExecutor, ref: string): Promise<string> {
  const short = shortBranchName(ref)
  return (await refExists(exec, `refs/tags/${short}`)) ? ref : short
}

export async function currentBranchName(exec: GitBranchActionExecutor): Promise<string | null> {
  try {
    const { stdout } = await exec(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Checks a full ref name such as `refs/heads/<name>` without git's `@{-1}` shorthand expansion. */
export async function assertValidRefName(
  exec: GitBranchActionExecutor,
  fullRef: string,
  label: string
): Promise<void> {
  if (!(await succeeds(exec, ['check-ref-format', fullRef]))) {
    throw new Error(`"${label}" is not a valid name.`)
  }
}

export async function listRemotes(exec: GitBranchActionExecutor): Promise<string[]> {
  const { stdout } = await exec(['remote'])
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name.length > 0)
}

export type RemoteBranch = { remote: string; branch: string }

/** Splits `refs/remotes/<remote>/<branch>`, matching the longest remote since names may hold `/`. */
export async function splitRemoteRef(
  exec: GitBranchActionExecutor,
  ref: string
): Promise<RemoteBranch> {
  const rest = ref.slice(REMOTE_PREFIX.length)
  const remote = (await listRemotes(exec))
    .filter((name) => rest.startsWith(`${name}/`) && rest.length > name.length + 1)
    .sort((a, b) => b.length - a.length)[0]
  if (!remote || !isSafeGitRemoteName(remote)) {
    throw new Error(`No remote owns ${rest}.`)
  }
  return { remote, branch: rest.slice(remote.length + 1) }
}

async function readConfig(exec: GitBranchActionExecutor, key: string): Promise<string | null> {
  try {
    const { stdout } = await exec(['config', '--get', key])
    return stdout.trim() || null
  } catch {
    return null
  }
}

export type PushDestination = { remote: string; remoteRef: string; setUpstream: boolean }

/** The branch's upstream when it has one, else `origin` (or the only remote) under the same name. */
export async function resolvePushDestination(
  exec: GitBranchActionExecutor,
  branch: string
): Promise<PushDestination> {
  const upstreamRemote = await readConfig(exec, `branch.${branch}.remote`)
  const upstreamMerge = await readConfig(exec, `branch.${branch}.merge`)
  if (upstreamRemote && upstreamRemote !== '.' && upstreamMerge?.startsWith(LOCAL_PREFIX)) {
    if (!isSafeGitRemoteName(upstreamRemote)) {
      throw new Error(`Branch ${branch} tracks an unsupported remote.`)
    }
    return { remote: upstreamRemote, remoteRef: upstreamMerge, setUpstream: false }
  }
  const remotes = await listRemotes(exec)
  const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null
  if (!remote || !isSafeGitRemoteName(remote)) {
    throw new Error('This repository has no remote to push to.')
  }
  return { remote, remoteRef: `${LOCAL_PREFIX}${branch}`, setUpstream: true }
}
