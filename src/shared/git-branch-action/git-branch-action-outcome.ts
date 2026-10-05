import { normalizeGitErrorMessage, stripCredentialsFromMessage } from '../git-remote-error'
import type {
  GitAbortableOperation,
  GitBranchActionExecutor,
  GitBranchActionKind,
  GitBranchActionResult
} from './git-branch-action-types'

const LOCAL_CHANGES_HEADER =
  /Your local changes to the following files would be overwritten by checkout:/
// Why: git ≥2.42 says "used by worktree"; older releases say "checked out".
const IN_OTHER_WORKTREE =
  /'([^'\n]+)' is already (?:checked out|used by worktree) at '([^'\n]+)'|delete branch '([^'\n]+)' (?:checked out|used by worktree) at '([^'\n]+)'/i
const MAX_ERROR_LINES = 6
const STOPPED_OPERATION_HEADS: readonly [string, GitAbortableOperation][] = [
  ['REBASE_HEAD', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['MERGE_HEAD', 'merge']
]

function errorField(error: unknown, field: 'stderr' | 'stdout'): string {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return ''
  }
  const value: unknown = Reflect.get(error, field)
  return typeof value === 'string' ? value.trim() : ''
}

/** Git's diagnostic for a failed command: its stderr (and stdout) when the runner kept them. */
export function gitFailureText(error: unknown): string {
  const output = [errorField(error, 'stderr'), errorField(error, 'stdout')].filter(Boolean)
  if (output.length > 0) {
    return output.join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

export function parseLocalChangesFiles(text: string): string[] | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => LOCAL_CHANGES_HEADER.test(line))
  if (start === -1) {
    return null
  }
  const files: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) {
      break
    }
    files.push(line.trim())
  }
  return files
}

export function parseOtherWorktree(text: string): { branch: string; worktreePath: string } | null {
  const match = IN_OTHER_WORKTREE.exec(text)
  if (!match) {
    return null
  }
  return { branch: match[1] ?? match[3] ?? '', worktreePath: match[2] ?? match[4] ?? '' }
}

/** Unmerged index entries; git's CONFLICT lines go to stdout, which some runners drop. */
export async function hasUnmergedPaths(exec: GitBranchActionExecutor): Promise<boolean> {
  try {
    const { stdout } = await exec(['ls-files', '--unmerged'])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Which operation git left stopped, read from its pseudo-refs (REBASE_HEAD needs Git 2.17). */
export async function detectStoppedOperation(
  exec: GitBranchActionExecutor
): Promise<GitAbortableOperation | null> {
  for (const [head, operation] of STOPPED_OPERATION_HEADS) {
    try {
      await exec(['rev-parse', '--quiet', '--verify', head])
      return operation
    } catch {
      // Not in progress.
    }
  }
  return null
}

/** Turns a refusal the UI can act on into a result; null means it is a plain failure. */
export async function classifyGitBranchActionFailure(
  exec: GitBranchActionExecutor,
  error: unknown
): Promise<GitBranchActionResult | null> {
  const text = gitFailureText(error)
  const otherWorktree = parseOtherWorktree(text)
  if (otherWorktree) {
    return { status: 'checked-out-elsewhere', ...otherWorktree }
  }
  // Why: a stopped merge/rebase/pick leaves its pseudo-ref, whatever the runner kept of the output.
  const operation = await detectStoppedOperation(exec)
  return operation ? { status: 'conflicts', operation } : null
}

function conciseGitError(text: string): string {
  const lines = stripCredentialsFromMessage(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !/^hint:/i.test(line))
    .filter((line) => !line.startsWith('Command failed: '))
  return lines.slice(0, MAX_ERROR_LINES).join('\n') || 'Git operation failed.'
}

/** A user-facing error for a failed action; remote operations reuse the push/pull guidance. */
export function gitBranchActionError(kind: GitBranchActionKind, error: unknown): Error {
  if (kind === 'fetch' || kind === 'push' || kind === 'pull') {
    const operation = kind === 'pull' ? 'pull' : kind
    return new Error(normalizeGitErrorMessage(asError(error), operation))
  }
  return new Error(conciseGitError(gitFailureText(error)))
}

function asError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error))
  }
  // Why: the normalizer reads the message, and some runners keep git's stderr in a separate field.
  const text = gitFailureText(error)
  return text === error.message ? error : new Error(`${error.message}\n${text}`)
}
