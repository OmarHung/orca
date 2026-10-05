import { runGitCheckout } from './git-branch-action-checkout'
import {
  classifyGitBranchActionFailure,
  gitBranchActionError,
  gitFailureText
} from './git-branch-action-outcome'
import {
  assertValidRefName,
  currentBranchName,
  isLocalBranchRef,
  mergeableName,
  requireRef,
  resolvePushDestination,
  shortBranchName,
  splitRemoteRef
} from './git-branch-action-refs'
import type {
  GitAbortableOperation,
  GitBranchAction,
  GitBranchActionExecutor,
  GitBranchActionResult
} from './git-branch-action-types'

const OK: GitBranchActionResult = { status: 'ok' }
const NOT_FULLY_MERGED = /is not fully merged/i

async function run(exec: GitBranchActionExecutor, args: string[]): Promise<GitBranchActionResult> {
  await exec(args)
  return OK
}

async function createBranch(
  exec: GitBranchActionExecutor,
  action: Extract<GitBranchAction, { kind: 'createBranch' }>
): Promise<GitBranchActionResult> {
  const ref = `refs/heads/${action.name}`
  await assertValidRefName(exec, ref, action.name)
  await exec(['branch', action.name, action.startPoint])
  // Why: create first, so refused local changes only need the checkout retried.
  return action.checkout ? runGitCheckout(exec, { kind: 'ref', ref }, 'safe') : OK
}

async function deleteBranch(
  exec: GitBranchActionExecutor,
  action: Extract<GitBranchAction, { kind: 'deleteBranch' }>
): Promise<GitBranchActionResult> {
  await requireRef(exec, action.ref)
  if (!isLocalBranchRef(action.ref)) {
    const { remote, branch } = await splitRemoteRef(exec, action.ref)
    return run(exec, ['push', remote, '--delete', `refs/heads/${branch}`])
  }
  const branch = shortBranchName(action.ref)
  try {
    return await run(exec, ['branch', action.force ? '-D' : '-d', branch])
  } catch (error) {
    if (!action.force && NOT_FULLY_MERGED.test(gitFailureText(error))) {
      return { status: 'not-fully-merged', branch }
    }
    throw error
  }
}

async function checkoutAndRebase(
  exec: GitBranchActionExecutor,
  ref: string
): Promise<GitBranchActionResult> {
  await requireRef(exec, ref)
  const branch = shortBranchName(ref)
  const current = await currentBranchName(exec)
  if (current === branch) {
    throw new Error(`${branch} is already the current branch.`)
  }
  const { stdout } = await exec(['rev-parse', '--verify', 'HEAD'])
  // Why: `rebase <upstream> <branch>` switches to the branch first, like JetBrains' action.
  return run(exec, ['rebase', '--autostash', current ?? stdout.trim(), branch])
}

async function pull(
  exec: GitBranchActionExecutor,
  action: Extract<GitBranchAction, { kind: 'pull' }>
): Promise<GitBranchActionResult> {
  const { remote, branch } = await splitRemoteRef(exec, action.ref)
  // Why: fetching the branch updates its remote-tracking ref through the remote's refspec.
  await exec(['fetch', remote, `refs/heads/${branch}`])
  await requireRef(exec, action.ref)
  return action.strategy === 'rebase'
    ? run(exec, ['rebase', '--autostash', action.ref])
    : run(exec, ['merge', '--no-edit', await mergeableName(exec, action.ref)])
}

async function push(exec: GitBranchActionExecutor, ref: string): Promise<GitBranchActionResult> {
  await requireRef(exec, ref)
  const branch = shortBranchName(ref)
  const destination = await resolvePushDestination(exec, branch)
  return run(exec, [
    'push',
    ...(destination.setUpstream ? ['--set-upstream'] : []),
    destination.remote,
    `${ref}:${destination.remoteRef}`
  ])
}

async function createTag(
  exec: GitBranchActionExecutor,
  action: Extract<GitBranchAction, { kind: 'createTag' }>
): Promise<GitBranchActionResult> {
  await assertValidRefName(exec, `refs/tags/${action.name}`, action.name)
  return run(
    exec,
    action.message
      ? ['tag', '-a', '-m', action.message, action.name, action.commit]
      : ['tag', action.name, action.commit]
  )
}

const ABORT_COMMANDS: Record<GitAbortableOperation, string[]> = {
  merge: ['merge', '--abort'],
  rebase: ['rebase', '--abort'],
  'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort']
}

async function dispatch(
  exec: GitBranchActionExecutor,
  action: GitBranchAction
): Promise<GitBranchActionResult> {
  switch (action.kind) {
    case 'fetch':
      return run(exec, ['fetch', '--all'])
    case 'checkout':
      return runGitCheckout(exec, { kind: 'ref', ref: action.ref }, action.mode)
    case 'checkoutRevision':
      return runGitCheckout(exec, { kind: 'commit', commit: action.commit }, action.mode)
    case 'createBranch':
      return createBranch(exec, action)
    case 'renameBranch':
      await requireRef(exec, action.ref)
      await assertValidRefName(exec, `refs/heads/${action.newName}`, action.newName)
      return run(exec, ['branch', '-m', shortBranchName(action.ref), action.newName])
    case 'deleteBranch':
      return deleteBranch(exec, action)
    case 'merge':
      await requireRef(exec, action.ref)
      return run(exec, ['merge', '--no-edit', await mergeableName(exec, action.ref)])
    case 'rebase':
      await requireRef(exec, action.ref)
      return run(exec, ['rebase', '--autostash', action.ref])
    case 'checkoutAndRebase':
      return checkoutAndRebase(exec, action.ref)
    case 'pull':
      return pull(exec, action)
    case 'push':
      return push(exec, action.ref)
    case 'cherryPick':
      return run(exec, ['cherry-pick', ...action.commits])
    case 'revert':
      return run(exec, ['revert', '--no-edit', ...action.commits])
    case 'reset':
      return run(exec, ['reset', `--${action.mode}`, action.commit])
    case 'createTag':
      return createTag(exec, action)
    case 'abortOperation':
      return run(exec, ABORT_COMMANDS[action.operation])
  }
}

/**
 * Runs a validated Git Log action with the host's git. Refusals the UI can follow up on (local
 * changes, conflicts, a branch used by another worktree, an unmerged delete) come back as results.
 */
export async function runGitBranchAction(
  exec: GitBranchActionExecutor,
  action: GitBranchAction
): Promise<GitBranchActionResult> {
  try {
    return await dispatch(exec, action)
  } catch (error) {
    const outcome = await classifyGitBranchActionFailure(exec, error)
    if (outcome) {
      return outcome
    }
    throw gitBranchActionError(action.kind, error)
  }
}
