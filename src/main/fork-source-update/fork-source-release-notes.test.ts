import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, runProcessMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  runProcessMock: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))
vi.mock('../startup/login-shell-environment', () => ({
  resolveLoginShellEnvironment: async () => ({})
}))

import {
  fetchUpstreamReleaseNotes,
  parseGitHubRemote,
  selectReleaseNotes
} from './fork-source-release-notes'

const identity = {
  repoRoot: '/src/orca',
  branch: 'omar/custom',
  baseTag: 'v1.4.211',
  upstreamRemote: 'origin',
  forkRemote: 'fork'
}

function release(tag: string, overrides: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `Orca ${tag}`,
    html_url: `https://github.com/stablyai/orca/releases/tag/${tag}`,
    published_at: '2026-09-30T00:00:00Z',
    body: `Notes for ${tag}`,
    draft: false,
    prerelease: false,
    ...overrides
  }
}

afterEach(() => {
  fetchMock.mockReset()
  runProcessMock.mockReset()
})

describe('parseGitHubRemote', () => {
  it('reads owner and repo from https and ssh remotes', () => {
    expect(parseGitHubRemote('https://github.com/stablyai/orca.git')).toEqual({
      owner: 'stablyai',
      repo: 'orca'
    })
    expect(parseGitHubRemote('git@github.com:stablyai/orca.git')).toEqual({
      owner: 'stablyai',
      repo: 'orca'
    })
    expect(parseGitHubRemote('ssh://git@github.com/stablyai/orca\n')).toEqual({
      owner: 'stablyai',
      repo: 'orca'
    })
  })

  it('returns null for other hosts', () => {
    expect(parseGitHubRemote('https://gitlab.com/stablyai/orca.git')).toBeNull()
    expect(parseGitHubRemote('origin')).toBeNull()
  })
})

describe('selectReleaseNotes', () => {
  it('keeps published releases after the base up to the target, newest first', () => {
    const notes = selectReleaseNotes(
      [
        release('v1.4.213'),
        release('v1.4.211'),
        release('v1.4.212'),
        release('v1.4.214'),
        release('v1.4.213-rc.1', { prerelease: true }),
        release('v1.4.212', { draft: true, tag_name: 'v1.4.212' }),
        { tag_name: 'v1.4.213', html_url: 'https://evil.example/' }
      ],
      'v1.4.211',
      'v1.4.213'
    )
    expect(notes.map((note) => note.tag)).toEqual(['v1.4.213', 'v1.4.212'])
    expect(notes[0]).toEqual({
      tag: 'v1.4.213',
      title: 'Orca v1.4.213',
      url: 'https://github.com/stablyai/orca/releases/tag/v1.4.213',
      publishedAt: '2026-09-30T00:00:00Z',
      body: 'Notes for v1.4.213'
    })
  })

  it('falls back to the tag for a missing title and cuts a huge body short', () => {
    const [note] = selectReleaseNotes(
      [release('v1.4.212', { name: '  ', body: 'x'.repeat(30_000) })],
      'v1.4.211',
      'v1.4.212'
    )
    expect(note.title).toBe('v1.4.212')
    expect(note.body.length).toBe(20_001)
    expect(note.body.endsWith('…')).toBe(true)
  })

  it('ignores a response that is not a list', () => {
    expect(selectReleaseNotes({ message: 'Not Found' }, 'v1.4.211', 'v1.4.212')).toEqual([])
  })
})

describe('fetchUpstreamReleaseNotes', () => {
  it("reads the upstream remote's GitHub releases", async () => {
    runProcessMock.mockResolvedValue({
      code: 0,
      stdout: 'https://github.com/stablyai/orca.git\n',
      stderr: ''
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release('v1.4.212')] })

    const notes = await fetchUpstreamReleaseNotes(identity, 'v1.4.211', 'v1.4.212')

    expect(runProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['remote', 'get-url', 'origin'], cwd: '/src/orca' })
    )
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/stablyai/orca/releases?per_page=30'
    )
    expect(notes.map((note) => note.tag)).toEqual(['v1.4.212'])
  })

  it('skips the request when the upstream is not on GitHub', async () => {
    runProcessMock.mockResolvedValue({ code: 0, stdout: 'https://gitlab.com/a/b.git', stderr: '' })

    expect(await fetchUpstreamReleaseNotes(identity, 'v1.4.211', 'v1.4.212')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on an error response', async () => {
    runProcessMock.mockResolvedValue({ code: 0, stdout: 'git@github.com:stablyai/orca', stderr: '' })
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })

    await expect(fetchUpstreamReleaseNotes(identity, 'v1.4.211', 'v1.4.212')).rejects.toThrow(
      '403'
    )
  })
})
