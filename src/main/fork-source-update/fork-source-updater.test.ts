import { describe, expect, it, vi } from 'vitest'
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
  upstreamTags = tags('v1.4.211', 'v1.4.212')
) {
  const published: UpdateStatus[] = []
  const installLocalBuild = vi.fn(async () => {})
  const deps: ForkSourceUpdaterDeps = {
    identity,
    publish: (status) => published.push(status),
    listUpstreamTags: async () => upstreamTags,
    runSync: async (_tag, onEvent) => runSync(onEvent),
    installLocalBuild
  }
  return { updater: new ForkSourceUpdater(deps), published, installLocalBuild }
}

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
