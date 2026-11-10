import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Store } from '../../persistence/loading-store/store'
import type { Repo } from '../../../shared/repo-types'
import type { RepoRelocateFailure } from '../../../shared/repo-relocation-types'
import { isFolderRepo } from '../../../shared/repo-kind'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import {
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../../shared/cross-platform-path'
import {
  getRepoIdFromWorktreeId,
  getRepoMainWorktreeId,
  rewriteWorktreeIdPath,
  splitWorktreeIdForFilesystem
} from '../../../shared/worktree/id'
import { gitExecFileAsync } from '../../git/runner'
import { inspectGitRepoForRegistrationAsync } from '../../git/repo'
import { findProjectAtSameRealPath } from '../../workspaces/catalog/project-realpath-identity'
import { hostWorktreeTargetForRepo } from '../../persistence/host-qualified-worktree-meta'
import { isWslMoveProjectBlocked } from '../../persistence/moving-wsl-projects/wsl-move-scope-guard'

export type RepoRelocation = {
  repo: Repo
  /** Old to new id of every workspace whose folder moved with the project. */
  worktreeIds: Map<string, string>
}

/** Points a local project at the folder it was moved to, keeping its settings and workspace state. */
export async function relocateLocalRepo(
  store: Store,
  repoId: string,
  requestedPath: string
): Promise<RepoRelocation | { error: RepoRelocateFailure }> {
  const repo = store.getRepo(repoId)
  if (!repo) {
    return { error: 'not-found' }
  }
  if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
    return { error: 'remote-host' }
  }
  if (isWslMoveProjectBlocked(store, { repoId })) {
    return { error: 'locked' }
  }
  if (typeof requestedPath !== 'string' || !isAbsolute(requestedPath)) {
    return { error: 'not-directory' }
  }
  if (!(await isDirectory(requestedPath))) {
    return { error: 'not-directory' }
  }
  const resolved = await resolveProjectRoot(repo, requestedPath)
  if ('error' in resolved) {
    return resolved
  }
  const newPath = resolved.path
  if (normalizeRuntimePathForComparison(newPath) === normalizeRuntimePathForComparison(repo.path)) {
    return { error: 'same-path' }
  }
  const otherLocalRepos = store
    .getRepos()
    .filter(
      (candidate) =>
        candidate.id !== repo.id && getRepoExecutionHostId(candidate) === LOCAL_EXECUTION_HOST_ID
    )
  const pathKey = normalizeRuntimePathForComparison(newPath)
  if (
    otherLocalRepos.some((other) => normalizeRuntimePathForComparison(other.path) === pathKey) ||
    (await findProjectAtSameRealPath(otherLocalRepos, newPath))
  ) {
    return { error: 'already-registered' }
  }

  const worktreeIds = movedWorktreeIds(store, repo, newPath)
  const updated = store.relocateRepo(repo, newPath)
  if (!updated) {
    return { error: 'not-found' }
  }
  for (const [oldId, newId] of worktreeIds) {
    store.migrateWorktreeIdentity(hostWorktreeTargetForRepo(oldId, updated), newId)
  }
  if (!isFolderRepo(updated)) {
    await repairLinkedWorktrees(newPath, worktreeIds)
  }
  return { repo: updated, worktreeIds }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function resolveProjectRoot(
  repo: Repo,
  path: string
): Promise<{ path: string } | { error: 'not-git-repo' | 'linked-worktree' }> {
  if (isFolderRepo(repo)) {
    return { path }
  }
  const info = await inspectGitRepoForRegistrationAsync(path)
  if (!info.isRepo) {
    return { error: 'not-git-repo' }
  }
  // A linked worktree's toplevel is not the project's main checkout.
  return info.mainRepoPath ? { error: 'linked-worktree' } : { path: info.rootPath }
}

/** The main workspace and any saved workspace inside the old folder follow it to the new one. */
function movedWorktreeIds(
  store: Pick<Store, 'getAllWorktreeMeta'>,
  repo: Repo,
  newPath: string
): Map<string, string> {
  const mapPath = (path: string): string => {
    const relative = relativePathInsideRoot(repo.path, path)
    if (relative === null) {
      return path
    }
    return relative === '' ? newPath : join(newPath, relative)
  }
  const candidates = new Set([
    getRepoMainWorktreeId(repo),
    ...Object.keys(store.getAllWorktreeMeta()).filter(
      (id) => getRepoIdFromWorktreeId(id) === repo.id
    )
  ])
  const ids = new Map<string, string>()
  for (const id of candidates) {
    const next = rewriteWorktreeIdPath(id, mapPath)
    if (next !== id) {
      ids.set(id, next)
    }
  }
  return ids
}

/** Linked worktrees still name the old `.git`; repair is best-effort so a stale one cannot undo the move. */
async function repairLinkedWorktrees(
  newPath: string,
  worktreeIds: ReadonlyMap<string, string>
): Promise<void> {
  const movedLinkedPaths = [...worktreeIds.values()]
    .map((id) => splitWorktreeIdForFilesystem(id)?.worktreePath)
    .filter(
      (path): path is string =>
        !!path &&
        normalizeRuntimePathForComparison(path) !== normalizeRuntimePathForComparison(newPath)
    )
  try {
    await gitExecFileAsync(['worktree', 'repair', ...movedLinkedPaths], { cwd: newPath })
  } catch (error) {
    console.warn('[repos] git worktree repair after relocating a project failed', error)
  }
}
