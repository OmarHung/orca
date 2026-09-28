export const GIT_BLAME_UNCOMMITTED_SHA = '0000000000000000000000000000000000000000'
// Why: blame output repeats every line; past this the transfer and parse outweigh a one-line hint.
export const GIT_BLAME_MAX_LINES = 20_000
const GIT_BLAME_MAX_BUFFER_BYTES = 32 * 1024 * 1024

export type GitBlameCommit = {
  sha: string
  author: string
  authorMail: string
  /** Seconds since the epoch. */
  authorTime: number
  summary: string
}

export type GitBlameResult =
  | {
      kind: 'blame'
      commits: GitBlameCommit[]
      /** Per file line (index 0 = line 1): index into `commits`. */
      lineCommits: number[]
      /** The blamed file's lines, so a reader can map them onto an edited buffer. */
      lineContents: string[]
    }
  | { kind: 'untracked' }
  | { kind: 'too-large' }

export type GitBlameExecutor = (
  args: string[],
  cwd: string,
  options?: { maxBuffer?: number }
) => Promise<{ stdout: string }>

type CommitHeaders = Partial<Pick<GitBlameCommit, 'author' | 'authorMail' | 'summary'>> & {
  authorTime?: number
}

function stripMailBrackets(value: string): string {
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
}

function applyHeader(headers: CommitHeaders, line: string): void {
  const space = line.indexOf(' ')
  const key = space === -1 ? line : line.slice(0, space)
  const value = space === -1 ? '' : line.slice(space + 1)
  if (key === 'author') {
    headers.author = value
  } else if (key === 'author-mail') {
    headers.authorMail = stripMailBrackets(value)
  } else if (key === 'author-time') {
    headers.authorTime = Number(value)
  } else if (key === 'summary') {
    headers.summary = value
  }
}

/** Parses `git blame --porcelain`, where a commit's headers appear only on its first line. */
export function parseGitBlamePorcelain(stdout: string): Extract<GitBlameResult, { kind: 'blame' }> {
  const commits: GitBlameCommit[] = []
  const commitIndexBySha = new Map<string, number>()
  const headersBySha = new Map<string, CommitHeaders>()
  const lineCommits: number[] = []
  const lineContents: string[] = []
  let currentSha: string | null = null
  let currentLine = 0

  const commitIndexFor = (sha: string): number => {
    const existing = commitIndexBySha.get(sha)
    if (existing !== undefined) {
      return existing
    }
    const headers = headersBySha.get(sha) ?? {}
    const index = commits.length
    commits.push({
      sha,
      author: headers.author ?? '',
      authorMail: headers.authorMail ?? '',
      authorTime: Number.isFinite(headers.authorTime) ? (headers.authorTime ?? 0) : 0,
      summary: headers.summary ?? ''
    })
    commitIndexBySha.set(sha, index)
    return index
  }

  for (const rawLine of stdout.split('\n')) {
    if (rawLine.startsWith('\t')) {
      if (currentSha !== null && currentLine > 0) {
        lineCommits[currentLine - 1] = commitIndexFor(currentSha)
        lineContents[currentLine - 1] = rawLine.slice(1).replace(/\r$/, '')
      }
      continue
    }
    const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(rawLine)
    if (header) {
      currentSha = header[1]
      currentLine = Number(header[2])
      if (!headersBySha.has(currentSha)) {
        headersBySha.set(currentSha, {})
      }
      continue
    }
    if (currentSha !== null && !commitIndexBySha.has(currentSha)) {
      applyHeader(headersBySha.get(currentSha) ?? {}, rawLine)
    }
  }
  return { kind: 'blame', commits, lineCommits, lineContents }
}

function isUntrackedBlameError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such path .* in HEAD|no such ref: HEAD|bad revision 'HEAD'/i.test(message)
}

function isBlameCommit(value: unknown): value is GitBlameCommit {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const commit: Partial<Record<keyof GitBlameCommit, unknown>> = value
  return (
    typeof commit.sha === 'string' &&
    typeof commit.author === 'string' &&
    typeof commit.authorMail === 'string' &&
    typeof commit.authorTime === 'number' &&
    typeof commit.summary === 'string'
  )
}

/** Checks a blame reply that crossed a process boundary (SSH relay) before the editor reads it. */
export function parseGitBlameResult(value: unknown): GitBlameResult {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    if (value.kind === 'untracked' || value.kind === 'too-large') {
      return { kind: value.kind }
    }
    if (
      value.kind === 'blame' &&
      'commits' in value &&
      'lineCommits' in value &&
      'lineContents' in value &&
      Array.isArray(value.commits) &&
      value.commits.every(isBlameCommit) &&
      Array.isArray(value.lineCommits) &&
      value.lineCommits.every((index) => Number.isInteger(index)) &&
      Array.isArray(value.lineContents) &&
      value.lineContents.every((line) => typeof line === 'string')
    ) {
      return {
        kind: 'blame',
        commits: value.commits,
        lineCommits: value.lineCommits,
        lineContents: value.lineContents
      }
    }
  }
  throw new Error('Unexpected git blame reply')
}

/** Blames the working-tree copy of one file; shared by the local main process and the SSH relay. */
export async function loadGitBlameFromExecutor(
  git: GitBlameExecutor,
  cwd: string,
  relativePath: string
): Promise<GitBlameResult> {
  let stdout: string
  try {
    ;({ stdout } = await git(['blame', '--porcelain', '--', relativePath], cwd, {
      maxBuffer: GIT_BLAME_MAX_BUFFER_BYTES
    }))
  } catch (error) {
    if (isUntrackedBlameError(error)) {
      return { kind: 'untracked' }
    }
    throw error
  }
  const result = parseGitBlamePorcelain(stdout)
  return result.lineCommits.length > GIT_BLAME_MAX_LINES ? { kind: 'too-large' } : result
}
