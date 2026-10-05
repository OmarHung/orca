import type {
  GitBranchActionConflictOperation,
  GitBranchActionResult
} from './git-branch-action-types'

const CONFLICT_OPERATIONS: readonly GitBranchActionConflictOperation[] = [
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'stash'
]

function invalid(): never {
  throw new Error('Unexpected branch action result from the host.')
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : invalid()
}

function readTarget(
  value: unknown
): Extract<GitBranchActionResult, { status: 'local-changes' }>['target'] {
  if (typeof value !== 'object' || value === null) {
    return invalid()
  }
  const record = Object.fromEntries(Object.entries(value))
  return record.kind === 'commit'
    ? { kind: 'commit', commit: readString(record, 'commit') }
    : { kind: 'ref', ref: readString(record, 'ref') }
}

/** Checks a result that crossed the SSH relay before the UI branches on it. */
export function parseGitBranchActionResult(value: unknown): GitBranchActionResult {
  if (typeof value !== 'object' || value === null) {
    return invalid()
  }
  const record = Object.fromEntries(Object.entries(value))
  switch (record.status) {
    case 'ok':
      return { status: 'ok' }
    case 'local-changes': {
      const files = Array.isArray(record.files) ? record.files : invalid()
      return {
        status: 'local-changes',
        target: readTarget(record.target),
        files: files.filter((file): file is string => typeof file === 'string')
      }
    }
    case 'checked-out-elsewhere':
      return {
        status: 'checked-out-elsewhere',
        branch: readString(record, 'branch'),
        worktreePath: readString(record, 'worktreePath')
      }
    case 'not-fully-merged':
      return { status: 'not-fully-merged', branch: readString(record, 'branch') }
    case 'conflicts': {
      const operation = CONFLICT_OPERATIONS.find((candidate) => candidate === record.operation)
      return operation ? { status: 'conflicts', operation } : invalid()
    }
    default:
      return invalid()
  }
}
