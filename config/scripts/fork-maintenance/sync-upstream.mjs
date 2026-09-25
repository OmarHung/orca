#!/usr/bin/env node
// Re-stacks this fork's own commits (omar/custom) onto a newer upstream release tag.
//
//   node config/scripts/fork-maintenance/sync-upstream.mjs v1.4.212 [--push] [--build]
//                                                          [--auto-worktree] [--events]
//
// Steps: fetch upstream tags → back up the branch → rebase --onto <new> <old> → install deps →
// typecheck + focused tests. --push force-with-lease pushes the branch and fast-forwards the fork's
// main to upstream main; --build then produces the local arm64 app.
// On a rebase conflict it stops and prints how to continue; rerere replays resolutions it has seen.
//
// App mode (Orca's "sync and update" button):
//   --auto-worktree  run in whichever worktree has omar/custom checked out, creating a dedicated
//                    one beside this checkout if none does, so the checkout you develop in is
//                    never switched or blocked by uncommitted work.
//   --events         print `ORCA_SYNC_EVENT <json>` lines (stage / conflict / done) and, on a
//                    conflict, abort the rebase so the branch is left exactly as before (exit 2).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const UPSTREAM_REMOTE = 'origin'
const FORK_REMOTE = 'fork'
const CUSTOM_BRANCH = 'omar/custom'
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/
const CONFLICT_EXIT_CODE = 2
const FOCUSED_TESTS = [
  'src/shared/git-history',
  'src/renderer/src/components/bottom-panel',
  'src/renderer/src/components/right-sidebar/source-control/sync'
]

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const scriptRelativePath = path.relative(repoRoot, import.meta.filename)

const args = process.argv.slice(2)
const targetTag = args.find((arg) => !arg.startsWith('--'))
const shouldPush = args.includes('--push')
const shouldBuild = args.includes('--build')
const autoWorktree = args.includes('--auto-worktree')
const eventsMode = args.includes('--events')

function emit(event) {
  if (eventsMode) {
    console.log(`ORCA_SYNC_EVENT ${JSON.stringify(event)}`)
  }
}

function stage(name) {
  emit({ type: 'stage', stage: name })
}

function run(command, commandArgs, cwd = repoRoot) {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`)
  execFileSync(command, commandArgs, { cwd, stdio: 'inherit' })
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`\n[sync-upstream] ${message}`)
  process.exit(1)
}

function compareReleaseTags(a, b) {
  const [pa, pb] = [a, b].map((tag) => tag.slice(1).split('.').map(Number))
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i]
    }
  }
  return 0
}

/** Worktree path that has CUSTOM_BRANCH checked out, or null. */
function findCustomBranchWorktree() {
  let worktreePath = null
  for (const line of git('worktree', 'list', '--porcelain').split('\n')) {
    if (line.startsWith('worktree ')) {
      worktreePath = line.slice('worktree '.length)
    } else if (line === `branch refs/heads/${CUSTOM_BRANCH}`) {
      return worktreePath
    }
  }
  return null
}

/** Re-runs this script inside the worktree that owns CUSTOM_BRANCH; never returns. */
function delegateToCustomBranchWorktree() {
  let worktree = findCustomBranchWorktree()
  if (!worktree) {
    worktree = `${repoRoot}-${CUSTOM_BRANCH.replace('/', '-')}`
    if (existsSync(worktree)) {
      fail(`${worktree} exists but is not a worktree of ${CUSTOM_BRANCH}. Move it aside and retry.`)
    }
    run('git', ['worktree', 'add', worktree, CUSTOM_BRANCH])
  }
  console.log(`[sync-upstream] Running in ${CUSTOM_BRANCH} worktree ${worktree}`)
  const forwarded = args.filter((arg) => arg !== '--auto-worktree')
  const child = spawnSync(
    process.execPath,
    [path.join(worktree, scriptRelativePath), ...forwarded],
    {
      cwd: worktree,
      stdio: 'inherit'
    }
  )
  process.exit(child.status ?? 1)
}

function conflictedFiles() {
  const output = git('diff', '--name-only', '--diff-filter=U')
  return output ? output.split('\n') : []
}

function stoppedCommitSubject() {
  try {
    return git('log', '-1', '--format=%s', 'REBASE_HEAD')
  } catch {
    return null
  }
}

function rebaseOnto(currentBase) {
  const ownCommits = git('log', '--oneline', `${currentBase}..HEAD`)
  console.log(
    `\n[sync-upstream] Moving these commits from ${currentBase} to ${targetTag}:\n${ownCommits}`
  )
  const backupBranch = `backup/${CUSTOM_BRANCH.replace('/', '-')}-${currentBase}`
  run('git', ['branch', '-f', backupBranch, 'HEAD'])
  console.log(`[sync-upstream] Backup saved as ${backupBranch}.`)

  try {
    run('git', ['rebase', '--onto', targetTag, currentBase, CUSTOM_BRANCH])
  } catch {
    if (eventsMode) {
      // Why abort in app mode: nobody is at a terminal to finish a half-applied rebase, so the
      // branch must return to its pre-sync state; the report says exactly what to resolve.
      emit({
        type: 'conflict',
        worktree: repoRoot,
        baseTag: currentBase,
        files: conflictedFiles(),
        commitSubject: stoppedCommitSubject()
      })
      execFileSync('git', ['rebase', '--abort'], { cwd: repoRoot, stdio: 'inherit' })
      process.exit(CONFLICT_EXIT_CODE)
    }
    fail(
      [
        'Rebase stopped on a conflict. Resolve the files, then:',
        '  git add <files> && git rebase --continue',
        `Then re-run this script with ${targetTag} (same flags) to verify, push, and build.`,
        `To give up: git rebase --abort (the branch returns to ${backupBranch}'s state).`
      ].join('\n')
    )
  }
}

if (!targetTag || !RELEASE_TAG.test(targetTag)) {
  fail(
    'Usage: sync-upstream.mjs <release tag, e.g. v1.4.212> [--push] [--build] [--auto-worktree] [--events]'
  )
}
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== CUSTOM_BRANCH) {
  if (autoWorktree) {
    delegateToCustomBranchWorktree()
  }
  fail(`Switch to ${CUSTOM_BRANCH} first (git switch ${CUSTOM_BRANCH}).`)
}
if (git('status', '--porcelain')) {
  fail(`${repoRoot} has uncommitted changes on ${CUSTOM_BRANCH}. Commit or stash them first.`)
}

stage('fetch')
run('git', ['fetch', UPSTREAM_REMOTE, '--tags', '--prune'])
try {
  git('rev-parse', '--verify', '--quiet', `refs/tags/${targetTag}`)
} catch {
  fail(`Tag ${targetTag} does not exist on ${UPSTREAM_REMOTE}.`)
}

// Why --exclude: rc/hourly tags ("-rc.1") are not release bases.
const currentBase = git(
  'describe',
  '--tags',
  '--abbrev=0',
  '--match',
  'v*',
  '--exclude',
  '*-*',
  'HEAD'
)
const comparison = compareReleaseTags(targetTag, currentBase)
if (comparison < 0) {
  fail(`${CUSTOM_BRANCH} is based on ${currentBase}; ${targetTag} is older.`)
}
// Why verify-only on an equal base: after resolving a conflict by hand the rebase is already done,
// and re-running the script with the same tag should still install, check, push, and build.
if (comparison === 0) {
  console.log(`\n[sync-upstream] Already based on ${targetTag}; verifying only.`)
} else {
  stage('rebase')
  rebaseOnto(currentBase)
}

stage('install')
run('pnpm', ['install', '--frozen-lockfile'])
stage('verify')
run('pnpm', ['tc'])
run('pnpm', ['test', ...FOCUSED_TESTS])

if (shouldPush) {
  stage('push')
  run('git', ['push', '--force-with-lease', FORK_REMOTE, CUSTOM_BRANCH])
  run('git', ['fetch', UPSTREAM_REMOTE, 'main'])
  // Why no force: the fork's main only mirrors upstream, so this must be a fast-forward.
  run('git', ['push', FORK_REMOTE, `${UPSTREAM_REMOTE}/main:main`])
}

if (shouldBuild) {
  stage('build')
  run('node', [path.join('config', 'scripts', 'fork-maintenance', 'build-mac-local-arm64.mjs')])
  emit({ type: 'done', manifestPath: path.join(repoRoot, 'dist', 'latest-mac.yml') })
}

console.log(`\n[sync-upstream] ${CUSTOM_BRANCH} is now based on ${targetTag}.`)
if (!shouldPush) {
  console.log(
    `Push when ready: git push --force-with-lease ${FORK_REMOTE} ${CUSTOM_BRANCH} && git push ${FORK_REMOTE} ${UPSTREAM_REMOTE}/main:main`
  )
}
