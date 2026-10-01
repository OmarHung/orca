import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../shared/update-status-types'
import type { ForkSyncEvent } from './fork-sync-events'
import {
  ForkSourceUpdater,
  type ForkSourceUpdaterDeps,
  type ForkSyncRunResult
} from './fork-source-updater'

const oid = 'a'.repeat(40)
const identity = {
  repoRoot: '/src/orca',
  branch: 'omar/custom',
  baseTag: 'v1.4.211',
  upstreamRemote: 'origin',
  forkRemote: 'fork'
}

function tags(...names: string[]): string {
  return names.map((name) => `${oid}\trefs/tags/${name}`).join('\n')
}

function setup(
  runSync: (emit: (event: ForkSyncEvent) => void) => ForkSyncRunResult | Promise<ForkSyncRunResult>,
  upstreamTags = tags('v1.4.211', 'v1.4.212'),
  fetchReleaseNotes: ForkSourceUpdaterDeps['fetchReleaseNotes'] = async () => []
) {
  const published: UpdateStatus[] = []
  const installLocalBuild = vi.fn(async () => {})
  const deps: ForkSourceUpdaterDeps = {
    identity,
    publish: (status) => published.push(status),
    listUpstreamTags: async () => upstreamTags,
    runSync: async (_tag, onEvent) => runSync(onEvent),
    installLocalBuild,
    fetchReleaseNotes
  }
  return { updater: new ForkSourceUpdater(deps), published, installLocalBuild }
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ForkSourceUpdater', () => {
  it('reports up to date when upstream has no newer release', async () => {
    const { updater } = setup(() => ({ code: 0, outputTail: '' }), tags('v1.4.211'))
    await updater.check(true)
    expect(updater.getStatus()).toEqual({ state: 'not-available', userInitiated: true })
    expect(updater.ownsActions()).toBe(false)
  })

  it('offers the newer upstream tag, syncs through stages, and hands the build to the installer', async () => {
    const { updater, published, installLocalBuild } = setup((emit) => {
      emit({ type: 'stage', stage: 'rebase' })
      emit({ type: 'stage', stage: 'build' })
      emit({ type: 'done', manifestPath: '/w/dist/latest-mac.yml' })
      return { code: 0, outputTail: '' }
    })
    await updater.check(false)
    expect(updater.getStatus()).toMatchObject({
      state: 'available',
      version: 'v1.4.212',
      forkSync: { phase: 'available', baseTag: 'v1.4.211', targetTag: 'v1.4.212' }
    })

    expect(updater.startSync()).toBe(true)
    await flush()
    const stages = published
      .filter((status) => status.forkSync?.phase === 'syncing')
      .map((status) => (status.forkSync?.phase === 'syncing' ? status.forkSync.stage : null))
    expect(stages).toEqual(['fetch', 'rebase', 'build'])
    expect(updater.getStatus()).toMatchObject({
      state: 'downloaded',
      forkSync: { phase: 'built', manifestPath: '/w/dist/latest-mac.yml' }
    })

    expect(updater.install()).toBe(true)
    expect(installLocalBuild).toHaveBeenCalledWith('/w/dist/latest-mac.yml')
    expect(updater.getStatus()).toBeNull()
  })

  it('offers the new tag with the release notes since the base', async () => {
    const note = {
      tag: 'v1.4.212',
      title: 'v1.4.212',
      url: 'https://github.com/stablyai/orca/releases/tag/v1.4.212',
      publishedAt: '2026-09-30T00:00:00Z',
      body: '## The short version'
    }
    const fetchReleaseNotes = vi.fn(async () => [note])
    const { updater } = setup(
      () => ({ code: 0, outputTail: '' }),
      tags('v1.4.211', 'v1.4.212'),
      fetchReleaseNotes
    )
    await updater.check(false)
    expect(fetchReleaseNotes).toHaveBeenCalledWith('v1.4.211', 'v1.4.212')
    expect(updater.getStatus()).toMatchObject({
      state: 'available',
      forkSync: { phase: 'available', releaseNotes: [note] }
    })
  })

  it('still offers the new tag when the release notes cannot be fetched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { updater } = setup(
      () => ({ code: 0, outputTail: '' }),
      tags('v1.4.211', 'v1.4.212'),
      async () => {
        throw new Error('rate limited')
      }
    )
    await updater.check(true)
    expect(updater.getStatus()).toEqual({
      state: 'available',
      version: 'v1.4.212',
      changelog: null,
      forkSync: { phase: 'available', baseTag: 'v1.4.211', targetTag: 'v1.4.212' }
    })
  })

  it('reports every conflicting commit from the dry run', async () => {
    const conflictCommits = [
      { sha: 'aaa111', subject: 'feat: git log panel', files: ['src/a.ts'] },
      { sha: 'bbb222', subject: 'feat: run window', files: ['src/b.ts', 'src/c.ts'] }
    ]
    const { updater } = setup((emit) => {
      emit({
        type: 'conflict',
        worktree: '/src/orca-omar-custom',
        baseTag: 'v1.4.211',
        files: ['src/a.ts'],
        commitSubject: 'feat: git log panel',
        conflictCommits
      })
      return { code: 2, outputTail: 'CONFLICT' }
    })
    await updater.check(false)
    updater.startSync()
    await flush()
    expect(updater.getStatus()).toMatchObject({
      message: '2 fork commits conflict with v1.4.212. The branch was left unchanged.',
      forkSync: { phase: 'conflict', conflictCommits }
    })
  })

  it('reports a conflict with the files and commit, and allows a retry', async () => {
    const { updater } = setup((emit) => {
      emit({ type: 'stage', stage: 'rebase' })
      emit({
        type: 'conflict',
        worktree: '/src/orca-omar-custom',
        baseTag: 'v1.4.211',
        files: ['src/a.ts', 'src/b.ts'],
        commitSubject: 'feat: git log panel'
      })
      return { code: 2, outputTail: 'CONFLICT' }
    })
    await updater.check(false)
    updater.startSync()
    await flush()
    expect(updater.getStatus()).toMatchObject({
      state: 'error',
      retryable: true,
      forkSync: {
        phase: 'conflict',
        repoRoot: '/src/orca-omar-custom',
        files: ['src/a.ts', 'src/b.ts'],
        commitSubject: 'feat: git log panel'
      }
    })
    expect(updater.startSync()).toBe(true)
  })

  it('reports a failure with the stage and output tail when the script exits non-zero', async () => {
    const { updater } = setup((emit) => {
      emit({ type: 'stage', stage: 'verify' })
      return { code: 1, outputTail: 'error TS2322' }
    })
    await updater.check(false)
    updater.startSync()
    await flush()
    expect(updater.getStatus()).toMatchObject({
      state: 'error',
      forkSync: { phase: 'failed', stage: 'verify', logTail: 'error TS2322' }
    })
  })

  it('ignores a second start while a sync is running', async () => {
    let finish: () => void = () => {}
    const { updater } = setup(
      () =>
        new Promise<ForkSyncRunResult>((resolve) => {
          finish = () => resolve({ code: 1, outputTail: '' })
        })
    )
    await updater.check(false)
    expect(updater.startSync()).toBe(true)
    expect(updater.startSync()).toBe(false)
    finish()
    await flush()
  })
})
