import { loadGitHistoryRefs, validateHistoryRefs } from './git-history-revisions'
import { gitHistoryTokens } from './git-history-token-store'
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
  const [branchList, logTarget] = await Promise.all([
    options.includeRefs ? loadGitHistoryBranches(git, cwd) : Promise.resolve(undefined),
    resolveLogTarget(git, cwd, options)
  ])
  const scoped = logTarget.scope !== 'head'
  const refs = options.branchOnly || scoped ? 'head' : (options.refs ?? 'head')
  validateHistoryRefs(refs)
  const scope = { revisionScope: logTarget.scope, ...withBranchList(branchList) }
  const empty = {
    items: [],
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit,
    refs,
    ...(Array.isArray(refs) ? { resolvedRefs: [] } : {}),
    ...scope
  }
  const requestedToken = options.branchOnly || scoped ? undefined : options.historyToken
  const pinned =
    requestedToken !== undefined ? gitHistoryTokens.get(requestedToken, cwd, refs) : undefined
  if (requestedToken !== undefined && !pinned) {
    return { ...empty, historyChanged: true }
  }
  const headOid = await resolveCommit(git, cwd, 'HEAD')
  const current = headOid ? await resolveCurrentRef(git, cwd, headOid) : undefined
  const currentRef = current?.currentRef
  const branchName = current?.branchName ?? null
  const [remoteRef, rawBaseRef] = await Promise.all([
    resolveUpstreamRef(git, cwd, branchName),
    resolveNamedRef(git, cwd, options.baseRef)
  ])

  const baseRef =
    rawBaseRef && rawBaseRef.id !== remoteRef?.id && rawBaseRef.id !== currentRef?.id
      ? rawBaseRef
      : undefined

  // The base may equal the upstream here (a branch tracking main), unlike the graph's comparison base.
  const branchBase =
    headOid &&
    currentRef &&
    options.branchOnly &&
    !scoped &&
    rawBaseRef?.revision &&
    !(await isBaseOfItself(git, cwd, rawBaseRef, currentRef))
      ? await resolveBranchRange(git, cwd, headOid, rawBaseRef)
      : undefined

  // Keep upstream/base as comparison metadata so old workspaces do not gain fetched commits outside their HEAD history.
  let historyRevisions = branchBase
    ? [headOid!, `^${branchBase.range.baseRef.revision}`]
    : headOid
      ? [headOid]
      : []
  let resolvedRefs: string[] | undefined
  if (scoped) {
    // Why drop HEAD: `git log HEAD` fails outright on an unborn branch.
    historyRevisions = headOid
      ? logTarget.revisions
      : logTarget.revisions.filter((revision) => revision !== 'HEAD')
  } else if (pinned) {
    historyRevisions = pinned.revisions
    resolvedRefs = pinned.resolvedRefs
  } else if (refs !== 'head') {
    const catalog = await loadGitHistoryRefs(git, cwd)
    const selected = Array.isArray(refs) ? new Set(refs) : undefined
    const chosen = selected ? catalog.filter((ref) => selected.has(ref.id)) : catalog
    resolvedRefs = selected ? chosen.map((ref) => ref.id).sort() : undefined
    historyRevisions = [
      ...new Set([
        ...(refs === 'all' && headOid ? [headOid] : []),
        ...chosen.flatMap((ref) => (ref.revision ? [ref.revision] : []))
      ])
    ]
  }
  const historyToken =
    requestedToken ??
    (options.refs !== undefined && !options.branchOnly && !scoped
      ? gitHistoryTokens.put(cwd, refs, historyRevisions, resolvedRefs)
      : undefined)
  const echo = { refs, ...(resolvedRefs ? { resolvedRefs } : {}), historyToken, ...scope }
  if (!historyRevisions.length) {
    return { ...empty, ...echo }
  }
  const skip = clampHistorySkip(options.skip)

  let mergeBase: string | undefined
  if (remoteRef?.revision && currentRef?.revision && remoteRef.revision !== currentRef?.revision) {
    try {
      const { stdout } = await git(['merge-base', currentRef?.revision, remoteRef.revision], cwd)
      mergeBase = stdout.trim() || undefined
    } catch {
      mergeBase = undefined
    }
  }

  let parsed: ReturnType<typeof parseGitHistoryLog>
  try {
    parsed = await runHistoryLog(git, cwd, limit, historyRevisions, {
      skip,
      shortstat: Boolean(branchBase),
      // Why: scoped revisions are oids or fixed pseudo-refs, but chosen ref catalogs can be long.
      stdin: !scoped && (refs !== 'head' || Boolean(pinned))
    })
  } catch (error) {
    if (pinned && /bad object|unknown revision|invalid object|bad revision/i.test(String(error))) {
      return { ...empty, ...echo, historyChanged: true }
    }
    throw error
  }
  const items = parsed.slice(0, limit)
  if (branchBase) {
    for (const item of items) {
      item.pushed = branchBase.unpushedIds ? !branchBase.unpushedIds.has(item.id) : false
    }
  }
  const hasIncomingChanges =
    Boolean(remoteRef?.revision && mergeBase) && remoteRef?.revision !== mergeBase
  const hasOutgoingChanges =
    Boolean(currentRef?.revision && remoteRef?.revision && mergeBase) &&
    currentRef?.revision !== mergeBase

  return {
    items,
    ...echo,
    currentRef,
    remoteRef,
    baseRef,
    mergeBase,
    hasIncomingChanges,
    hasOutgoingChanges,
    hasMore: parsed.length > limit,
    limit,
    ...(branchBase ? { branch: branchBase.range } : {}),
    ...(options.skip !== undefined ? { skip } : {})
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
  {
    skip,
    shortstat = false,
    stdin = false
  }: { skip: number; shortstat?: boolean; stdin?: boolean }
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
      ...(stdin ? ['--stdin'] : revisions)
    ],
    cwd,
    stdin ? `${revisions.join('\n')}\n` : undefined
  )
  return parseGitHistoryLog(stdout)
}

function withBranchList(branchList: GitHistoryBranchList | undefined): {
  branchList?: GitHistoryBranchList
} {
  return branchList ? { branchList } : {}
}
