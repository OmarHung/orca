import type { Repo } from './repo-types'

export type RepoRelocateFailure =
  | 'not-found'
  | 'remote-host'
  | 'not-directory'
  | 'not-git-repo'
  | 'linked-worktree'
  | 'same-path'
  | 'already-registered'
  | 'locked'

export type RepoRelocateResult = { repo: Repo } | { error: RepoRelocateFailure }
