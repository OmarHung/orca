import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type { CookiesGetFilter } from 'electron'

const {
  appGetPathMock,
  copyFileSyncMock,
  execFileSyncMock,
  sessionFromPartitionMock,
  setPendingCookieImportMock,
  clearPendingCookieImportMock,
  writeCookieIdentityMock
} = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  copyFileSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  sessionFromPartitionMock: vi.fn(),
  setPendingCookieImportMock: vi.fn(),
  clearPendingCookieImportMock: vi.fn(),
  writeCookieIdentityMock: vi.fn()
}))

vi.mock('../sessions/profiles/browser-session-registry', () => ({
  browserSessionRegistry: {
    setPendingCookieImport: setPendingCookieImportMock,
    clearPendingCookieImport: clearPendingCookieImportMock
  }
}))
vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    copyFileSync: (...args: Parameters<typeof actual.copyFileSync>) => {
      copyFileSyncMock(...args)
      return actual.copyFileSync(...args)
    }
  }
})
vi.mock('electron', () => ({
  app: { getPath: appGetPathMock },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  session: { fromPartition: sessionFromPartitionMock }
}))
vi.mock('./browser-cookie-clear-store', () => ({
  openCookieClearStore: (targetSession: {
    cookies: {
      get: (filter: CookiesGetFilter) => Promise<unknown>
      remove: (url: string, name: string) => Promise<void>
    }
  }) => ({
    get: (filter: CookiesGetFilter) => targetSession.cookies.get(filter),
    remove: (url: string, name: string) => targetSession.cookies.remove(url, name),
    snapshotClearIdentities: async (items: { cookie: Record<string, unknown>; url: string }[]) =>
      items.map(({ cookie, url }) => ({ url, ...cookie })),
    restoreClearIdentities: async () => undefined,
    // Implement CDP writes so swallowed missing-method errors cannot fake successful coverage.
    writeCookieIdentity: writeCookieIdentityMock,
    dispose: () => undefined
  })
}))
import { importCookiesFromBrowser } from './browser-cookie-import'
import { createChromiumCookieTestDatabase } from './browser-cookie-import-test-database'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DetectedBrowser } from './sources/browser-cookie-source-profiles'

function chromeBrowser(cookiesPath: string): DetectedBrowser {
  return {
    family: 'chrome',
    label: 'Google Chrome',
    cookiesPath,
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
    profiles: [{ name: 'Default', directory: 'Default' }],
    selectedProfile: 'Default'
  }
}

const unreachableCookieSet = vi.fn(async (details: { name: string }) => {
  if (details.name !== '__init') {
    throw new Error(`cookies.set was called for user cookie ${details.name}`)
  }
})

describe('native Chromium import partition fidelity', () => {
  let tmpDir: string
  let cookieWriteMock: ReturnType<typeof vi.fn>
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orca-partition-fidelity-native-'))
    cookieWriteMock = writeCookieIdentityMock
    cookieWriteMock.mockReset()
    cookieWriteMock.mockResolvedValue(undefined)
    appGetPathMock.mockReset().mockReturnValue(join(tmpDir, 'userData'))
    copyFileSyncMock.mockClear()
    setPendingCookieImportMock.mockClear()
    clearPendingCookieImportMock.mockClear()
    execFileSyncMock.mockReset().mockImplementation(() => {
      throw new Error('OS credential commands are unavailable in this test')
    })
    sessionFromPartitionMock.mockReset().mockReturnValue({
      cookies: {
        get: vi.fn().mockResolvedValue([]),
        set: unreachableCookieSet,
        remove: vi.fn().mockResolvedValue(undefined),
        flushStore: vi.fn().mockResolvedValue(undefined)
      },
      clearData: vi.fn().mockResolvedValue(undefined),
      setUserAgent: vi.fn(),
      getStoragePath: () => join(tmpDir, 'userData', 'Partitions', 'test')
    })
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  })

  afterEach(() => {
    platformSpy.mockRestore()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('imports a family whose odd rows are partitioned under browser-internal pages', async () => {
    const sourceCookiesPath = join(tmpDir, 'Chrome', 'Default', 'Network', 'Cookies')
    createChromiumCookieTestDatabase(sourceCookiesPath, [
      {
        domain: '.youtube.com',
        name: 'extension-partitioned',
        value: 'unreachable',
        isSecure: 1,
        topFrameSiteKey: 'chrome-extension://gppongmhjkpfnbhagpmjfkannfbllamg',
        hasCrossSiteAncestor: 1
      },
      {
        domain: '.youtube.com',
        name: 'whats-new-partitioned',
        value: 'unreachable',
        isSecure: 1,
        topFrameSiteKey: 'chrome://whats-new',
        hasCrossSiteAncestor: 1
      },
      { domain: '.youtube.com', name: 'LOGIN_INFO', value: 'keep-me', isSecure: 1 }
    ]).close()
    createChromiumCookieTestDatabase(
      join(tmpDir, 'userData', 'Partitions', 'test', 'Network', 'Cookies'),
      []
    ).close()

    const result = await importCookiesFromBrowser(chromeBrowser(sourceCookiesPath), 'persist:test')

    expect(result.ok).toBe(true)
    expect(cookieWriteMock).toHaveBeenCalledTimes(1)
    expect(cookieWriteMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'LOGIN_INFO' }))
    expect(result.ok && result.summary).toMatchObject({
      totalCookies: 3,
      importedCookies: 1,
      skippedCookies: 2
    })
    expect(result.ok && result.summary?.partitionSkippedCookies).toBeUndefined()
  })
})
