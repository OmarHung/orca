#!/usr/bin/env node
// Re-stacks this fork's own commits (omar/custom) onto a newer upstream release tag.
//
//   node config/scripts/fork-maintenance/sync-upstream.mjs v1.4.212 [--push] [--build]
//
// Steps: fetch upstream tags → back up the branch → rebase --onto <new> <old> → install deps →
// typecheck + focused tests. --push force-with-lease pushes the branch and fast-forwards the fork's
// main to upstream main; --build then produces the local arm64 app.
// On a rebase conflict it stops and prints how to continue; rerere replays resolutions it has seen.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const UPSTREAM_REMOTE = 'origin'
const FORK_REMOTE = 'fork'
const CUSTOM_BRANCH = 'omar/custom'
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/
const FOCUSED_TESTS = [
  'src/shared/git-history',
  'src/renderer/src/components/bottom-panel',
  'src/renderer/src/components/right-sidebar/source-control/sync'
]

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options })
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
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

const args = process.argv.slice(2)
const targetTag = args.find((arg) => !arg.startsWith('--'))
const shouldPush = args.includes('--push')
const shouldBuild = args.includes('--build')

if (!targetTag || !RELEASE_TAG.test(targetTag)) {
  fail('Usage: sync-upstream.mjs <release tag, e.g. v1.4.212> [--push] [--build]')
}
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== CUSTOM_BRANCH) {
  fail(`Switch to ${CUSTOM_BRANCH} first (git switch ${CUSTOM_BRANCH}).`)
}
if (git('status', '--porcelain')) {
  fail('The working tree has uncommitted changes. Commit or stash them first.')
}

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
  rebaseOnto(currentBase)
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

run('pnpm', ['install', '--frozen-lockfile'])
run('pnpm', ['tc'])
run('pnpm', ['test', ...FOCUSED_TESTS])

if (shouldPush) {
  run('git', ['push', '--force-with-lease', FORK_REMOTE, CUSTOM_BRANCH])
  run('git', ['fetch', UPSTREAM_REMOTE, 'main'])
  // Why no force: the fork's main only mirrors upstream, so this must be a fast-forward.
  run('git', ['push', FORK_REMOTE, `${UPSTREAM_REMOTE}/main:main`])
}

if (shouldBuild) {
  run('node', [path.join('config', 'scripts', 'fork-maintenance', 'build-mac-local-arm64.mjs')])
}

console.log(`\n[sync-upstream] ${CUSTOM_BRANCH} is now based on ${targetTag}.`)
if (!shouldPush) {
  console.log(
    `Push when ready: git push --force-with-lease ${FORK_REMOTE} ${CUSTOM_BRANCH} && git push ${FORK_REMOTE} ${UPSTREAM_REMOTE}/main:main`
  )
}
