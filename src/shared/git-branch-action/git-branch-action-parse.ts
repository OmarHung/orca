import type {
  GitAbortableOperation,
  GitBranchAction,
  GitCheckoutMode,
  GitPullStrategy,
  GitResetMode
} from './git-branch-action-types'

const MAX_REF_LENGTH = 1024
const MAX_NAME_LENGTH = 255
const MAX_TAG_MESSAGE_LENGTH = 10_000
const MAX_COMMITS = 200
const COMMIT_ID_PATTERN = /^[0-9a-f]{4,64}$/i
// Why: only branch namespaces are acted on; git re-checks the rest with check-ref-format.
const BRANCH_REF_PATTERN = /^refs\/(heads|remotes)\/[^\s\0\\]+$/
const LOCAL_REF_PREFIX = 'refs/heads/'
const CHECKOUT_MODES: readonly GitCheckoutMode[] = ['safe', 'smart', 'force']
const RESET_MODES: readonly GitResetMode[] = ['soft', 'mixed', 'hard', 'keep']
const PULL_STRATEGIES: readonly GitPullStrategy[] = ['merge', 'rebase']
const ABORTABLE_OPERATIONS: readonly GitAbortableOperation[] = [
  'merge',
  'rebase',
  'cherry-pick',
  'revert'
]

function fail(field: string): never {
  throw new Error(`Invalid branch action: ${field}`)
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('action')
  }
  return Object.fromEntries(Object.entries(value))
}

function readBranchRef(record: Record<string, unknown>, field = 'ref'): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length > MAX_REF_LENGTH) {
    fail(field)
  }
  if (!BRANCH_REF_PATTERN.test(value) || value.includes('..')) {
    fail(field)
  }
  return value
}

function readLocalBranchRef(record: Record<string, unknown>): string {
  const ref = readBranchRef(record)
  return ref.startsWith(LOCAL_REF_PREFIX) ? ref : fail('ref')
}

function readCommit(record: Record<string, unknown>, field = 'commit'): string {
  const value = record[field]
  return typeof value === 'string' && COMMIT_ID_PATTERN.test(value) ? value : fail(field)
}

function readCommits(record: Record<string, unknown>): string[] {
  const value = record.commits
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMMITS) {
    fail('commits')
  }
  return value.map((commit) =>
    typeof commit === 'string' && COMMIT_ID_PATTERN.test(commit) ? commit : fail('commits')
  )
}

/** A new branch or tag name; `-` is refused so it can never read as an option. */
function readName(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') {
    fail(field)
  }
  const name = value.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || name.startsWith('-')) {
    fail(field)
  }
  return name
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T {
  const match = allowed.find((candidate) => candidate === record[field])
  return match ?? fail(field)
}

/** A branch ref or a commit id, for the start point of a new branch. */
function readStartPoint(record: Record<string, unknown>): string {
  const value = record.startPoint
  if (typeof value === 'string' && COMMIT_ID_PATTERN.test(value)) {
    return value
  }
  return readBranchRef(record, 'startPoint')
}

function readTagMessage(record: Record<string, unknown>): string | undefined {
  const value = record.message
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string' || value.length > MAX_TAG_MESSAGE_LENGTH) {
    fail('message')
  }
  return value.trim() || undefined
}

/** Validates an untrusted branch action; every host entry point calls it before running git. */
export function parseGitBranchAction(value: unknown): GitBranchAction {
  const record = readRecord(value)
  switch (record.kind) {
    case 'fetch':
      return { kind: 'fetch' }
    case 'checkout':
      return {
        kind: 'checkout',
        ref: readBranchRef(record),
        mode: readEnum(record, 'mode', CHECKOUT_MODES)
      }
    case 'checkoutRevision':
      return {
        kind: 'checkoutRevision',
        commit: readCommit(record),
        mode: readEnum(record, 'mode', CHECKOUT_MODES)
      }
    case 'createBranch':
      return {
        kind: 'createBranch',
        name: readName(record, 'name'),
        startPoint: readStartPoint(record),
        checkout: record.checkout === true
      }
    case 'renameBranch':
      return {
        kind: 'renameBranch',
        ref: readLocalBranchRef(record),
        newName: readName(record, 'newName')
      }
    case 'deleteBranch':
      return { kind: 'deleteBranch', ref: readBranchRef(record), force: record.force === true }
    case 'merge':
    case 'rebase':
      return { kind: record.kind, ref: readBranchRef(record) }
    case 'checkoutAndRebase':
    case 'push':
      return { kind: record.kind, ref: readLocalBranchRef(record) }
    case 'pull': {
      const ref = readBranchRef(record)
      return ref.startsWith(LOCAL_REF_PREFIX)
        ? fail('ref')
        : { kind: 'pull', ref, strategy: readEnum(record, 'strategy', PULL_STRATEGIES) }
    }
    case 'cherryPick':
    case 'revert':
      return { kind: record.kind, commits: readCommits(record) }
    case 'reset':
      return {
        kind: 'reset',
        commit: readCommit(record),
        mode: readEnum(record, 'mode', RESET_MODES)
      }
    case 'createTag': {
      const message = readTagMessage(record)
      return {
        kind: 'createTag',
        name: readName(record, 'name'),
        commit: readCommit(record),
        ...(message ? { message } : {})
      }
    }
    case 'abortOperation':
      return {
        kind: 'abortOperation',
        operation: readEnum(record, 'operation', ABORTABLE_OPERATIONS)
      }
    default:
      return fail('kind')
  }
}
