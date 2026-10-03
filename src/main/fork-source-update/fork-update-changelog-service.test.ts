import { describe, expect, it, vi } from 'vitest'
import type { ForkUpdateChangelog } from '../../shared/fork-update-changelog'
import type { ChangelogAgentResult } from './fork-update-changelog-agent'
import type { ForkChangelogFile } from './fork-update-changelog-file'
import {
  ForkUpdateChangelogService,
  type ForkChangelogServiceDeps
} from './fork-update-changelog-service'

const note = {
  tag: 'v1.4.219',
  title: 'Orca 1.4.219',
  url: 'https://github.com/stablyai/orca/releases/tag/v1.4.219',
  publishedAt: '2026-10-02T00:00:00Z',
  body: '- Sparse checkout scope in the explorer'
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function setup(
  initial: ForkChangelogFile,
  summarize: ForkChangelogServiceDeps['summarize'] = async () => ({
    ok: true,
    markdown: '## 新功能',
    agentLabel: 'Claude'
  })
) {
  let file = initial
  const published: (ForkUpdateChangelog | null)[] = []
  const deps: ForkChangelogServiceDeps = {
    current: { baseTag: 'v1.4.219', commit: 'f0feeec92724' },
    readFile: () => file,
    writeFile: (next) => (file = next),
    fetchReleaseNotes: vi.fn(async () => [note]),
    listForkCommits: vi.fn(async () => [{ sha: 'abc', subject: 'feat: changelog dialog' }]),
    summarize: vi.fn(summarize),
    publish: (changelog) => published.push(changelog),
    now: () => 1_000
  }
  const service = new ForkUpdateChangelogService(deps)
  return { service, deps, published, readFile: () => file }
}

const updatedFile: ForkChangelogFile = {
  lastLaunch: { baseTag: 'v1.4.218', commit: 'e1d7c76c5c00' },
  changelog: null
}

describe('ForkUpdateChangelogService', () => {
  it('records the first launch without making a changelog', async () => {
    const { service, readFile } = setup({ lastLaunch: null, changelog: null })
    service.start()
    expect(await service.get()).toBeNull()
    expect(readFile().lastLaunch).toEqual({ baseTag: 'v1.4.219', commit: 'f0feeec92724' })
  })

  it('makes no changelog when the base tag did not move', async () => {
    const { service, deps } = setup({
      lastLaunch: { baseTag: 'v1.4.219', commit: 'aaaaaaaaaaaa' },
      changelog: null
    })
    service.start()
    expect(await service.get()).toBeNull()
    expect(deps.fetchReleaseNotes).not.toHaveBeenCalled()
  })

  it('collects release notes and fork commits since the previous build after an update', async () => {
    const { service, deps, readFile } = setup(updatedFile)
    service.start()
    const changelog = await service.get()
    expect(changelog).toMatchObject({
      fromTag: 'v1.4.218',
      toTag: 'v1.4.219',
      releaseNotes: [note],
      forkCommits: [{ sha: 'abc', subject: 'feat: changelog dialog' }],
      summary: null,
      seen: false
    })
    expect(deps.fetchReleaseNotes).toHaveBeenCalledWith('v1.4.218', 'v1.4.219')
    expect(deps.listForkCommits).toHaveBeenCalledWith({
      fromTag: 'v1.4.218',
      fromCommit: 'e1d7c76c5c00',
      toTag: 'v1.4.219',
      toCommit: 'f0feeec92724'
    })
    expect(readFile().changelog?.toTag).toBe('v1.4.219')
  })

  it('keeps the changelog when release notes or commits are unavailable', async () => {
    const { service, deps } = setup(updatedFile)
    vi.mocked(deps.fetchReleaseNotes).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(deps.listForkCommits).mockRejectedValueOnce(new Error('git missing'))
    service.start()
    expect(await service.get()).toMatchObject({ releaseNotes: [], forkCommits: null })
  })

  it('summarizes in the requested locale and publishes each step', async () => {
    const { service, deps, published } = setup(updatedFile)
    service.start()
    await service.ensureSummary('zh-TW')
    await vi.waitFor(() => expect(published.at(-1)?.summary?.status).toBe('ready'))
    expect(published.map((entry) => entry?.summary?.status ?? null)).toEqual([
      null,
      'generating',
      'ready'
    ])
    expect(published.at(-1)?.summary).toEqual({
      status: 'ready',
      locale: 'zh-TW',
      markdown: '## 新功能',
      agentLabel: 'Claude'
    })
    expect(vi.mocked(deps.summarize).mock.calls[0][1]).toBe('zh-TW')
  })

  it('does not rerun a ready summary in the same locale but reruns for another locale', async () => {
    const { service, deps, published } = setup(updatedFile)
    service.start()
    await service.ensureSummary('zh-TW')
    await vi.waitFor(() => expect(published.at(-1)?.summary?.status).toBe('ready'))
    await service.ensureSummary('zh-TW')
    expect(deps.summarize).toHaveBeenCalledTimes(1)
    await service.ensureSummary('en')
    expect(deps.summarize).toHaveBeenCalledTimes(2)
  })

  it('records a failed summary and lets the user retry it', async () => {
    const result: ChangelogAgentResult = { ok: false, error: 'Claude failed: not logged in' }
    const { service, deps, published } = setup(updatedFile, async () => result)
    service.start()
    await service.ensureSummary('en')
    await vi.waitFor(() => expect(published.at(-1)?.summary?.status).toBe('failed'))
    await service.ensureSummary('en')
    expect(deps.summarize).toHaveBeenCalledTimes(1)
    await service.regenerate('en')
    expect(deps.summarize).toHaveBeenCalledTimes(2)
  })

  it('ignores a superseded run that finishes after the newer one started', async () => {
    const first = deferred<ChangelogAgentResult>()
    const { service, deps, published } = setup(updatedFile)
    vi.mocked(deps.summarize).mockImplementationOnce(() => first.promise)
    service.start()
    await service.ensureSummary('en')
    await service.ensureSummary('zh-TW')
    await vi.waitFor(() => expect(published.at(-1)?.summary?.status).toBe('ready'))
    first.resolve({ ok: true, markdown: 'stale English', agentLabel: 'Claude' })
    await Promise.resolve()
    expect((await service.get())?.summary).toMatchObject({ status: 'ready', locale: 'zh-TW' })
  })

  it('restarts a summary that a quit interrupted', async () => {
    const interrupted: ForkChangelogFile = {
      lastLaunch: { baseTag: 'v1.4.219', commit: 'f0feeec92724' },
      changelog: {
        fromTag: 'v1.4.218',
        toTag: 'v1.4.219',
        releaseNotes: [note],
        forkCommits: [],
        summary: { status: 'generating', locale: 'en' },
        seen: false,
        createdAt: 1
      }
    }
    const { service, deps } = setup(interrupted)
    service.start()
    await service.ensureSummary('en')
    expect(deps.summarize).toHaveBeenCalledTimes(1)
  })

  it('marks the changelog seen once', async () => {
    const { service, published } = setup(updatedFile)
    service.start()
    await service.get()
    service.markSeen()
    service.markSeen()
    expect(published.filter((entry) => entry?.seen)).toHaveLength(1)
  })
})
