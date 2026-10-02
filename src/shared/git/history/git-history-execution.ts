import {
  GIT_HISTORY_COMMIT_FORMAT,
  gitHistoryRefFromFullName,
  parseGitHistoryLog,
  shortGitHash
} from './git-history-log-parser'
import {
  GIT_HISTORY_DEFAULT_LIMIT,
  GIT_HISTORY_MAX_LIMIT,
  type GitHistoryBranchList,
  type GitHistoryExecutor,
  type GitHistoryItemRef,
  type GitHistoryOptions,
  type GitHistoryResult
} from './git-history-types'
import { getGitCurrentBranchName } from '../refs/git-current-branch'
import { isBaseOfItself, resolveBranchRange } from './git-history-branch-range'
import { isGitHistoryBranchRefName, loadGitHistoryBranches } from './git-history-branches'
import { loadHeadMergeBases } from './git-history-head-merge-bases'

function clampHistoryLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return GIT_HISTORY_DEFAULT_LIMIT
  }
  return Math.min(
    GIT_HISTORY_MAX_LIMIT,
    Math.max(1, Math.trunc(limit ?? GIT_HISTORY_DEFAULT_LIMIT))
  )
}

async function resolveCommit(
  git: GitHistoryExecutor,
  cwd: string,
  ref: string
): Promise<string | null> {
  if (!ref || ref.startsWith('-')) {
    return null
  }
  try {
    const { stdout } = await git(
      ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
      cwd
    )
    const oid = stdout.trim()
    return oid || null
  } catch {
    return null
  }
}

async function resolveSymbolicFullName(
  git: GitHistoryExecutor,
  cwd: string,
  ref: string
): Promise<string | null> {
  if (!ref || ref.startsWith('-')) {
    return null
  }
  try {
    const { stdout } = await git(
      ['rev-parse', '--symbolic-full-name', '--end-of-options', ref],
      cwd
    )
    // --symbolic-full-name echoes --end-of-options; skip it or branches/tags fall through ref-prefix checks as commits.
    return (
      stdout
        .trim()
        .split(/\r?\n/)
        .find((line) => line && line !== '--end-of-options') ?? null
    )
  } catch {
    return null
  }
}

async function resolveCurrentRef(
  git: GitHistoryExecutor,
  cwd: string,
  headOid: string
): Promise<{ currentRef: GitHistoryItemRef; branchName: string | null }> {
  const branchName = await getGitCurrentBranchName((args) => git(args, cwd))
  if (branchName) {
    return {
      branchName,
      currentRef: {
        id: `refs/heads/${branchName}`,
        name: branchName,
        revision: headOid,
        category: 'branches'
      }
    }
  }

  return {
    branchName: null,
    currentRef: {
      id: headOid,
      name: shortGitHash(headOid),
      revision: headOid,
      category: 'commits'
    }
  }
}

async function resolveUpstreamRef(
  git: GitHistoryExecutor,
  cwd: string,
  branchName: string | null
): Promise<GitHistoryItemRef | undefined> {
  if (!branchName) {
    return undefined
  }
  try {
    const { stdout } = await git(
      ['for-each-ref', '--format=%(upstream)%00%(upstream:short)', `refs/heads/${branchName}`],
      cwd
    )
    const [fullName, shortName] = stdout.split('\0')
    const upstreamRef = fullName?.trim()
    const upstreamShortName = shortName?.trim()
    if (!upstreamRef || !upstreamShortName) {
      return undefined
    }
    // Resolve upstream names then commit OIDs; %(upstream:objectname) is not portable across Git versions.
    const oid = await resolveCommit(git, cwd, upstreamRef)
    return oid ? gitHistoryRefFromFullName(upstreamRef, upstreamShortName, oid) : undefined
  } catch {
    return undefined
  }
}

async function resolveNamedRef(
  git: GitHistoryExecutor,
  cwd: string,
  ref: string | null | undefined
): Promise<GitHistoryItemRef | undefined> {
  const normalized = ref?.trim()
  if (!normalized || normalized.startsWith('-')) {
    return undefined
  }
  const [revision, fullName] = await Promise.all([
    resolveCommit(git, cwd, normalized),
    resolveSymbolicFullName(git, cwd, normalized)
  ])
  return revision ? gitHistoryRefFromFullName(fullName, normalized, revision) : undefined
}

export async function loadGitHistoryFromExecutor(
  git: GitHistoryExecutor,
  cwd: string,
  options: GitHistoryOptions = {}
): Promise<GitHistoryResult> {
  const limit = clampHistoryLimit(options.limit)
  const [headOid, refs] = await Promise.all([
    resolveCommit(git, cwd, 'HEAD'),
    options.includeRefs ? loadGitHistoryBranches(git, cwd) : Promise.resolve(undefined)
  ])
  const logTarget = await resolveLogTarget(git, cwd, options)
  if (!headOid) {
    if (logTarget.scope !== 'head') {
      // Why: an unborn HEAD with an explicit branch still has a log to show, just no current-branch metadata.
      return loadScopedLogWithoutHead(git, cwd, limit, logTarget, refs, options.skip)
    }
    return {
      items: [],
      hasIncomingChanges: false,
      hasOutgoingChanges: false,
      hasMore: false,
      limit,
      revisionScope: 'head',
      ...withRefs(refs)
    }
  }
  const { currentRef, branchName } = await resolveCurrentRef(git, cwd, headOid)
  const [remoteRef, rawBaseRef] = await Promise.all([
    resolveUpstreamRef(git, cwd, branchName),
    resolveNamedRef(git, cwd, options.baseRef)
  ])

  const baseRef =
    rawBaseRef && rawBaseRef.id !== remoteRef?.id && rawBaseRef.id !== currentRef.id
      ? rawBaseRef
      : undefined

  // The base may equal the upstream here (a branch tracking main), unlike the graph's comparison base.
  const branchBase =
    options.branchOnly &&
    logTarget.scope === 'head' &&
    rawBaseRef?.revision &&
    !(await isBaseOfItself(git, cwd, rawBaseRef, currentRef))
      ? await resolveBranchRange(git, cwd, headOid, rawBaseRef)
      : undefined

  // Keep upstream/base as comparison metadata so old workspaces do not gain fetched commits outside their HEAD history.
  const skip = clampHistorySkip(options.skip)
  const headRevisions = branchBase ? [headOid, `^${branchBase.range.baseRef.revision}`] : [headOid]
  const historyRevisions = logTarget.scope === 'head' ? headRevisions : logTarget.revisions

  let mergeBase: string | undefined
  if (remoteRef?.revision && currentRef.revision && remoteRef.revision !== currentRef.revision) {
    try {
      const { stdout } = await git(['merge-base', currentRef.revision, remoteRef.revision], cwd)
      mergeBase = stdout.trim() || undefined
    } catch {
      mergeBase = undefined
    }
  }

  const path = options.path?.trim() || undefined
  const [parsed, headMergeBases] = await Promise.all([
    runHistoryLog(git, cwd, limit, historyRevisions, {
      skip,
      shortstat: Boolean(branchBase),
      path
    }),
    logTarget.scope === 'ref'
      ? loadHeadMergeBases(git, cwd, headOid, logTarget.revisions)
      : undefined
  ])
  const items = parsed.slice(0, limit)
  if (branchBase) {
    for (const item of items) {
      item.pushed = branchBase.unpushedIds ? !branchBase.unpushedIds.has(item.id) : false
    }
  }
  const hasIncomingChanges =
    Boolean(remoteRef?.revision && mergeBase) && remoteRef?.revision !== mergeBase
  const hasOutgoingChanges =
    Boolean(currentRef.revision && remoteRef?.revision && mergeBase) &&
    currentRef.revision !== mergeBase

  return {
    items,
    currentRef,
    remoteRef,
    baseRef,
    mergeBase,
    hasIncomingChanges,
    hasOutgoingChanges,
    hasMore: parsed.length > limit,
    limit,
    ...(branchBase ? { branch: branchBase.range } : {}),
    ...(options.skip !== undefined ? { skip } : {}),
    revisionScope: logTarget.scope,
    ...(headMergeBases ? { headMergeBases } : {}),
    ...withRefs(refs),
    ...(path ? { path } : {})
  }
}

function clampHistorySkip(skip: number | undefined): number {
  return Number.isFinite(skip) ? Math.max(0, Math.trunc(skip ?? 0)) : 0
}

type LogTarget = { scope: 'head' } | { scope: 'ref' | 'all'; revisions: string[] }

// Why resolve to oids: `git log` then never sees user-chosen text, so ref names can't smuggle options or ranges.
async function resolveLogTarget(
  git: GitHistoryExecutor,
  cwd: string,
  options: GitHistoryOptions
): Promise<LogTarget> {
  if (options.allBranches) {
    return { scope: 'all', revisions: ['--branches', '--remotes', 'HEAD'] }
  }
  const revision = options.revision?.trim()
  if (!revision) {
    return { scope: 'head' }
  }
  if (!isGitHistoryBranchRefName(revision)) {
    throw new Error(`Not a branch: ${revision}`)
  }
  const oid = await resolveCommit(git, cwd, revision)
  if (!oid) {
    throw new Error(`Branch not found: ${revision}`)
  }
  return { scope: 'ref', revisions: [oid] }
}

async function runHistoryLog(
  git: GitHistoryExecutor,
  cwd: string,
  limit: number,
  revisions: string[],
  { skip, shortstat = false, path }: { skip: number; shortstat?: boolean; path?: string }
) {
  const { stdout } = await git(
    [
      'log',
      '--no-show-signature',
      '--no-color',
      `--format=${GIT_HISTORY_COMMIT_FORMAT}`,
      '-z',
      '--topo-order',
      '--decorate=full',
      ...(shortstat ? ['--shortstat'] : []),
      ...(skip > 0 ? [`--skip=${skip}`] : []),
      `-n${limit + 1}`,
      ...revisions,
      ...(path ? ['--', path] : [])
    ],
    cwd
  )
  return parseGitHistoryLog(stdout)
}

async function loadScopedLogWithoutHead(
  git: GitHistoryExecutor,
  cwd: string,
  limit: number,
  logTarget: Exclude<LogTarget, { scope: 'head' }>,
  refs: GitHistoryBranchList | undefined,
  requestedSkip: number | undefined
): Promise<GitHistoryResult> {
  // Why drop HEAD: `git log HEAD` fails outright on an unborn branch.
  const revisions = logTarget.revisions.filter((revision) => revision !== 'HEAD')
  const skip = clampHistorySkip(requestedSkip)
  const parsed = await runHistoryLog(git, cwd, limit, revisions, { skip })
  return {
    items: parsed.slice(0, limit),
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: parsed.length > limit,
    limit,
    ...(requestedSkip !== undefined ? { skip } : {}),
    revisionScope: logTarget.scope,
    ...withRefs(refs)
  }
}

function withRefs(refs: GitHistoryBranchList | undefined): { refs?: GitHistoryBranchList } {
  return refs ? { refs } : {}
}
