import {
  closeTestStores,
  testState,
  createStore,
  writeDataFile,
  makeRepo
} from './persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultPersistedState } from '../shared/constants'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').replace('encrypted:', '')
  }
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))
vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn()
}))

describe('repo initial tab persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-initial-tab-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('persists the chosen initial tab across a reload', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())

    expect(store.updateRepo('r1', { initialTab: 'terminal' })!.initialTab).toBe('terminal')
    store.flush()

    const reloaded = await createStore()
    expect(reloaded.getRepo('r1')!.initialTab).toBe('terminal')
  })

  it('ignores an unknown initial tab update', async () => {
    const store = await createStore()
    store.addRepo(makeRepo({ initialTab: 'codex' }))

    // Why: parse bypasses the type the way an untyped IPC or RPC payload does.
    const updated = store.updateRepo('r1', JSON.parse('{"initialTab":"browser"}'))

    expect(updated!.initialTab).toBe('codex')
  })

  it('does not expose an unknown persisted initial tab', async () => {
    writeDataFile({
      ...getDefaultPersistedState(testState.dir),
      repos: [{ ...makeRepo(), initialTab: 'browser' }]
    })

    const store = await createStore()

    expect(store.getRepo('r1')!.initialTab).toBeUndefined()
  })
})
