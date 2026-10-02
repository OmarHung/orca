import type { GitHistoryOptions } from '../../../shared/git-history'

/** Keeps only the history options the renderer may set, with loose values normalized. */
export function readGitHistoryIpcOptions(args: GitHistoryOptions): GitHistoryOptions {
  return {
    limit: args.limit,
    baseRef: args.baseRef,
    revision: typeof args.revision === 'string' ? args.revision : null,
    allBranches: args.allBranches === true,
    includeRefs: args.includeRefs === true,
    path: typeof args.path === 'string' ? args.path : null,
    markCherryPicks: args.markCherryPicks === true
  }
}
