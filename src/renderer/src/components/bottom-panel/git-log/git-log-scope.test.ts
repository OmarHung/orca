import { describe, expect, it } from 'vitest'
import type { GitHistoryResult } from '../../../../../shared/git-history'
import {
  ALL_GIT_LOG_SCOPE,
  HEAD_GIT_LOG_SCOPE,
  gitLogScopeKey,
  gitLogScopeToHistoryOptions,
  isGitLogScopeHonored
} from './git-log-scope'

function result(revisionScope?: GitHistoryResult['revisionScope']): GitHistoryResult {
  return {
    items: [],
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 50,
    revisionScope
  }
}

const refScope = { kind: 'ref', fullName: 'refs/heads/other' } as const

describe('git log scope', () => {
  it('maps each scope to history options and a stable key', () => {
    expect(gitLogScopeToHistoryOptions(HEAD_GIT_LOG_SCOPE)).toEqual({})
    expect(gitLogScopeToHistoryOptions(ALL_GIT_LOG_SCOPE)).toEqual({ allBranches: true })
    expect(gitLogScopeToHistoryOptions(refScope)).toEqual({ revision: 'refs/heads/other' })
    expect(gitLogScopeKey(refScope)).toBe('ref:refs/heads/other')
  })

  it('treats a missing revisionScope as an older host that logged HEAD only', () => {
    expect(isGitLogScopeHonored(refScope, result(undefined))).toBe(false)
    expect(isGitLogScopeHonored(ALL_GIT_LOG_SCOPE, result(undefined))).toBe(false)
    expect(isGitLogScopeHonored(HEAD_GIT_LOG_SCOPE, result(undefined))).toBe(true)
    expect(isGitLogScopeHonored(refScope, result('ref'))).toBe(true)
  })
})
