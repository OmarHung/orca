import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createForkChangelogFileStore,
  parseForkChangelogFile,
  type ForkChangelogFile
} from './fork-update-changelog-file'

const sample: ForkChangelogFile = {
  lastLaunch: { baseTag: 'v1.4.219', commit: 'f0feeec92724' },
  changelog: {
    fromTag: 'v1.4.218',
    toTag: 'v1.4.219',
    releaseNotes: [],
    forkCommits: null,
    summary: { status: 'ready', locale: 'zh-TW', markdown: '## 修正', agentLabel: 'Claude' },
    seen: true,
    createdAt: 1
  }
}

let dir: string | null = null

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
})

describe('fork changelog file', () => {
  it('round-trips through disk', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'fork-changelog-'))
    const store = createForkChangelogFileStore(dir)
    store.write(sample)
    expect(store.read()).toEqual(sample)
    expect(JSON.parse(readFileSync(path.join(dir, 'fork-update-changelog.json'), 'utf8'))).toEqual(
      sample
    )
  })

  it('starts empty when the file is missing or corrupt', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'fork-changelog-'))
    const store = createForkChangelogFileStore(dir)
    expect(store.read()).toEqual({ lastLaunch: null, changelog: null })
    writeFileSync(path.join(dir, 'fork-update-changelog.json'), '{not json')
    expect(store.read()).toEqual({ lastLaunch: null, changelog: null })
  })

  it('rejects a file with the wrong shape', () => {
    expect(parseForkChangelogFile({ lastLaunch: { baseTag: 3 }, changelog: null })).toEqual({
      lastLaunch: null,
      changelog: null
    })
  })
})
