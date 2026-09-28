import { isGitReadInterruptedError } from './git-buffer-overflow'
import { readBlobAtOid, type GitBufferExec, type GitExec } from './git-handler-ops'
import { gitChangeListArgs, parseGitChangeList } from '../shared/git-change-list'
import { buildDiffResult } from './git-diff-result'
import { parseGitRevListCommitAndFirstParentOid } from '../shared/git-rev-list-output'

const FULL_GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/

function assertFullGitObjectId(value: string, label: string): void {
  if (!FULL_GIT_OBJECT_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a full git object id`)
  }
}

export async function commitCompare(
  git: GitExec,
  worktreePath: string,
  commitId: string,
  baseCommitId?: string
) {
  assertFullGitObjectId(commitId, 'commitId')
  if (baseCommitId !== undefined) {
    assertFullGitObjectId(baseCommitId, 'baseCommitId')
  }
  let commitOid = ''
  let parentOid: string | null = null
  let parentReadFailure: { error: unknown } | undefined
  try {
    const { stdout } = await git(
      ['rev-list', '--parents', '-n', '1', '--end-of-options', `${commitId}^{commit}`],
      worktreePath
    )
    ;({ commitOid, parentOid } = parseGitRevListCommitAndFirstParentOid(stdout))
  } catch (error) {
    // Why: preserve invalid-commit versus a resolved commit with unreadable parents on failure.
    try {
      const { stdout } = await git(
        ['rev-parse', '--verify', '--end-of-options', `${commitId}^{commit}`],
        worktreePath
      )
      commitOid = stdout.trim()
    } catch (error) {
      if (isGitReadInterruptedError(error)) {
        throw error
      }
      return {
        summary: {
          commitOid: '',
          parentOid: null,
          compareRef: commitId,
          baseRef: 'parent',
          changedFiles: 0,
          status: 'invalid-commit',
          errorMessage: `Commit ${commitId} could not be resolved in this repository.`
        },
        entries: []
      }
    }
    parentReadFailure = { error }
  }

  const summary = {
    commitOid,
    parentOid: null as string | null,
    compareRef: commitOid.slice(0, 7),
    baseRef: 'empty tree',
    changedFiles: 0,
    status: 'ready' as const
  }

  try {
    // Why: an explicit base replaces the first parent, so an unreadable parent list doesn't matter.
    if (parentReadFailure && !baseCommitId) {
      throw parentReadFailure.error
    }
    const baseOid = baseCommitId
      ? (
          await git(
            ['rev-parse', '--verify', '--end-of-options', `${baseCommitId}^{commit}`],
            worktreePath
          )
        ).stdout.trim()
      : parentOid
    summary.parentOid = baseOid
    summary.baseRef = baseOid ? baseOid.slice(0, 7) : 'empty tree'

    const { stdout } = await git(gitChangeListArgs(summary.parentOid, commitOid), worktreePath)
    const entries = parseGitChangeList(stdout)
    summary.changedFiles = entries.length
    return { summary, entries }
  } catch (error) {
    return {
      summary: {
        ...summary,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to load commit diff'
      },
      entries: []
    }
  }
}

export async function commitDiffEntry(
  gitBuffer: GitBufferExec,
  worktreePath: string,
  args: {
    commitOid: string
    parentOid?: string | null
    filePath: string
    oldPath?: string
  }
) {
  assertFullGitObjectId(args.commitOid, 'commitOid')
  if (args.parentOid) {
    assertFullGitObjectId(args.parentOid, 'parentOid')
  }
  try {
    const oldPath = args.oldPath ?? args.filePath
    const [left, right] = await Promise.all([
      args.parentOid
        ? readBlobAtOid(gitBuffer, worktreePath, args.parentOid, oldPath)
        : Promise.resolve({ content: '', isBinary: false }),
      readBlobAtOid(gitBuffer, worktreePath, args.commitOid, args.filePath)
    ])
    return buildDiffResult(
      left.content,
      right.content,
      left.isBinary,
      right.isBinary,
      args.filePath
    )
  } catch (error) {
    if (isGitReadInterruptedError(error)) {
      throw error
    }
    return {
      kind: 'text',
      originalContent: '',
      modifiedContent: '',
      originalIsBinary: false,
      modifiedIsBinary: false
    }
  }
}
