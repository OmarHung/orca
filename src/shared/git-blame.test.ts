import { describe, expect, it } from 'vitest'
import {
  GIT_BLAME_UNCOMMITTED_SHA,
  loadGitBlameFromExecutor,
  parseGitBlamePorcelain,
  parseGitBlameResult
} from './git-blame'

const ALICE = '7e6c71ed012d2cbaca466ce0fb2abfdb04378b30'
const BOB = '10de99a9536304d2204b96c845a2357c68128b4d'

function headers(author: string, mail: string, summary: string): string[] {
  return [
    `author ${author}`,
    `author-mail <${mail}>`,
    'author-time 1790607473',
    'author-tz +0800',
    `committer ${author}`,
    `committer-mail <${mail}>`,
    'committer-time 1790607473',
    'committer-tz +0800',
    `summary ${summary}`
  ]
}

// Captured from `git blame --porcelain` (git 2.54): headers appear only on a commit's first line.
const PORCELAIN = [
  `${ALICE} 1 1 1`,
  ...headers('Alice Chen', 'alice@x.io', 'add f'),
  'filename f.txt',
  '\tone',
  `${BOB} 2 2 1`,
  ...headers('Bob', 'bob@x.io', 'change two'),
  `previous ${ALICE} f.txt`,
  'filename f.txt',
  '\tTWO',
  `${ALICE} 3 3 1`,
  '\tthree',
  `${BOB} 4 4 1`,
  '\tfour\r',
  `${GIT_BLAME_UNCOMMITTED_SHA} 5 5 1`,
  ...headers('Not Committed Yet', 'not.committed.yet', 'Version of f.txt from f.txt'),
  'filename f.txt',
  '\tfive',
  ''
].join('\n')

describe('parseGitBlamePorcelain', () => {
  it('maps every line to its commit and keeps the line text', () => {
    const result = parseGitBlamePorcelain(PORCELAIN)
    expect(result.commits.map((commit) => [commit.sha, commit.author, commit.summary])).toEqual([
      [ALICE, 'Alice Chen', 'add f'],
      [BOB, 'Bob', 'change two'],
      [GIT_BLAME_UNCOMMITTED_SHA, 'Not Committed Yet', 'Version of f.txt from f.txt']
    ])
    expect(result.commits[0]).toMatchObject({ authorMail: 'alice@x.io', authorTime: 1790607473 })
    expect(result.lineCommits).toEqual([0, 1, 0, 1, 2])
    expect(result.lineContents).toEqual(['one', 'TWO', 'three', 'four', 'five'])
  })
})

describe('loadGitBlameFromExecutor', () => {
  it('reports an untracked file instead of failing', async () => {
    const git = async (): Promise<{ stdout: string }> => {
      throw new Error("fatal: no such path 'u.txt' in HEAD")
    }
    await expect(loadGitBlameFromExecutor(git, '/repo', 'u.txt')).resolves.toEqual({
      kind: 'untracked'
    })
  })

  it('passes the path after -- and rethrows other failures', async () => {
    const calls: string[][] = []
    const git = async (args: string[]): Promise<{ stdout: string }> => {
      calls.push(args)
      return { stdout: PORCELAIN }
    }
    const result = await loadGitBlameFromExecutor(git, '/repo', '-weird.txt')
    expect(calls[0]).toEqual(['blame', '--porcelain', '--', '-weird.txt'])
    expect(result.kind).toBe('blame')

    const failing = async (): Promise<{ stdout: string }> => {
      throw new Error('fatal: not a git repository')
    }
    await expect(loadGitBlameFromExecutor(failing, '/repo', 'f.txt')).rejects.toThrow(
      'not a git repository'
    )
  })
})

describe('parseGitBlameResult', () => {
  it('accepts well-formed replies and rejects anything else', () => {
    const blame = parseGitBlamePorcelain(PORCELAIN)
    expect(parseGitBlameResult(blame)).toEqual(blame)
    expect(parseGitBlameResult({ kind: 'untracked' })).toEqual({ kind: 'untracked' })
    expect(() => parseGitBlameResult({ kind: 'blame', commits: [{}], lineCommits: [0] })).toThrow()
    expect(() => parseGitBlameResult('nope')).toThrow()
  })
})
