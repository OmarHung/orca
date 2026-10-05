import {
  gitFailureText,
  hasUnmergedPaths,
  parseLocalChangesFiles
} from './git-branch-action-outcome'
import {
  isLocalBranchRef,
  refExists,
  requireRef,
  shortBranchName,
  splitRemoteRef
} from './git-branch-action-refs'
import type {
  GitBranchActionExecutor,
  GitBranchActionResult,
  GitCheckoutMode
} from './git-branch-action-types'

const SMART_CHECKOUT_STASH_MESSAGE = 'Orca smart checkout'

type CheckoutTarget = { kind: 'ref'; ref: string } | { kind: 'commit'; commit: string }

async function stashTop(exec: GitBranchActionExecutor): Promise<string | null> {
  try {
    const { stdout } = await exec(['rev-parse', '--quiet', '--verify', 'refs/stash'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** The checkout argv for a branch or commit; a remote branch gets a local tracking branch. */
async function checkoutArgs(
  exec: GitBranchActionExecutor,
  target: CheckoutTarget,
  force: boolean
): Promise<string[]> {
  const base = ['checkout', ...(force ? ['--force'] : [])]
  if (target.kind === 'commit') {
    return [...base, '--detach', target.commit, '--']
  }
  await requireRef(exec, target.ref)
  if (isLocalBranchRef(target.ref)) {
    return [...base, shortBranchName(target.ref), '--']
  }
  const { branch } = await splitRemoteRef(exec, target.ref)
  // Why: like JetBrains, an existing local branch of the same name is checked out as is.
  if (await refExists(exec, `refs/heads/${branch}`)) {
    return [...base, branch, '--']
  }
  return [...base, '-b', branch, '--track', target.ref]
}

/** Stashes tracked changes, checks out, then re-applies them; conflicts leave the stash entry. */
async function smartCheckout(
  exec: GitBranchActionExecutor,
  args: string[]
): Promise<GitBranchActionResult> {
  const before = await stashTop(exec)
  await exec(['stash', 'push', '-m', SMART_CHECKOUT_STASH_MESSAGE])
  const after = await stashTop(exec)
  const stashed = after !== null && after !== before
  try {
    await exec(args)
  } catch (error) {
    if (stashed) {
      await exec(['stash', 'pop', '--index']).catch(() => exec(['stash', 'pop']))
    }
    throw error
  }
  if (!stashed) {
    return { status: 'ok' }
  }
  try {
    await exec(['stash', 'pop'])
  } catch (error) {
    if (await hasUnmergedPaths(exec)) {
      return { status: 'conflicts', operation: 'stash' }
    }
    throw error
  }
  return { status: 'ok' }
}

export async function runGitCheckout(
  exec: GitBranchActionExecutor,
  target: CheckoutTarget,
  mode: GitCheckoutMode
): Promise<GitBranchActionResult> {
  const args = await checkoutArgs(exec, target, mode === 'force')
  if (mode === 'smart') {
    return smartCheckout(exec, args)
  }
  try {
    await exec(args)
    return { status: 'ok' }
  } catch (error) {
    const files = mode === 'safe' ? parseLocalChangesFiles(gitFailureText(error)) : null
    if (files) {
      return { status: 'local-changes', target, files }
    }
    throw error
  }
}
