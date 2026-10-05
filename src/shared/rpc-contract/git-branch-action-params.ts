import { z } from 'zod'
import { parseGitBranchAction } from '../git-branch-action/git-branch-action-parse'
import { WorktreeSelector } from './git-params'

export const GitBranchActionParams = WorktreeSelector.extend({
  action: z.unknown().transform((value, ctx) => {
    try {
      return parseGitBranchAction(value)
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid branch action'
      })
      return z.NEVER
    }
  })
})
