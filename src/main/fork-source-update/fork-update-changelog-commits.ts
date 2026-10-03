import type { ForkChangelogCommit } from '../../shared/fork-update-changelog'

/** Runs git in the fork's source checkout; resolves stdout, rejects on a non-zero exit. */
export type ForkChangelogGit = (args: string[]) => Promise<string>

const MAX_FORK_COMMITS = 200
const FIELD_SEPARATOR = '\u001f'

function parseLog(stdout: string): ForkChangelogCommit[] {
  return stdout
    .split('\n')
    .map((line) => line.split(FIELD_SEPARATOR))
    .filter((fields): fields is [string, string] => fields.length === 2 && fields[0].length > 0)
    .map(([sha, subject]) => ({ sha, subject }))
}

function logForkRange(git: ForkChangelogGit, tag: string, commit: string): Promise<string> {
  return git([
    'log',
    '--no-merges',
    `--max-count=${MAX_FORK_COMMITS * 5}`,
    `--format=%H${FIELD_SEPARATOR}%s`,
    `${tag}..${commit}`,
    '--'
  ])
}

/**
 * Fork commits in the new build that the previous build did not have. The fork branch is rebased
 * on every sync, so commits are matched by subject rather than by hash. Null when either build's
 * commit is unknown or the previous one is no longer in the checkout.
 */
export async function listNewForkCommits(
  git: ForkChangelogGit,
  input: { fromTag: string; fromCommit: string | null; toTag: string; toCommit: string | null }
): Promise<ForkChangelogCommit[] | null> {
  if (!input.fromCommit || !input.toCommit) {
    return null
  }
  try {
    const [current, previous] = await Promise.all([
      logForkRange(git, input.toTag, input.toCommit),
      logForkRange(git, input.fromTag, input.fromCommit)
    ])
    const previousSubjects = new Set(parseLog(previous).map((commit) => commit.subject))
    return parseLog(current)
      .filter((commit) => !previousSubjects.has(commit.subject))
      .slice(0, MAX_FORK_COMMITS)
  } catch {
    return null
  }
}

/** The commit stamped into a local build's version, e.g. `1.4.219-local.<ms>.<commit12>`. */
export function parseLocalBuildCommit(version: string): string | null {
  return /-local\.\d+\.([0-9a-f]{7,40})$/i.exec(version)?.[1] ?? null
}
