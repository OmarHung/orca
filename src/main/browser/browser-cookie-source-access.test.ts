import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { appGetPathMock, copyFileSyncMock, sessionFromPartitionMock } = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  copyFileSyncMock: vi.fn(),
  sessionFromPartitionMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: appGetPathMock },
  session: { fromPartition: sessionFromPartitionMock }
}))
vi.mock('./browser-session-registry', () => ({
  browserSessionRegistry: {
    setPendingCookieImport: vi.fn(),
    clearPendingCookieImport: vi.fn()
  }
}))
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

import { importCookiesFromBrowser, type DetectedBrowser } from './browser-cookie-import'
import { createChromiumCookieTestDatabase } from './browser-cookie-import-test-database'
import {
  isMacPrivacyDenial,
  macPrivacyDenialReason,
  sourceCopyFailureReason
} from './browser-cookie-source-access'

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: copyfile`), { code })
}

describe('isMacPrivacyDenial', () => {
  it('treats EPERM on macOS as a privacy denial', () => {
    expect(isMacPrivacyDenial(errnoError('EPERM'), 'darwin')).toBe(true)
  })

  it('leaves Windows EPERM to the lock message', () => {
    expect(isMacPrivacyDenial(errnoError('EPERM'), 'win32')).toBe(false)
  })

  it('ignores other macOS copy errors', () => {
    expect(isMacPrivacyDenial(errnoError('EBUSY'), 'darwin')).toBe(false)
    expect(isMacPrivacyDenial('EPERM', 'darwin')).toBe(false)
  })
})

describe('source cookie copy failures', () => {
  let tmpDir: string
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orca-cookie-source-access-test-'))
    appGetPathMock.mockReturnValue(join(tmpDir, 'userData'))
    sessionFromPartitionMock.mockReturnValue({
      cookies: {
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        flushStore: vi.fn().mockResolvedValue(undefined)
      },
      getStoragePath: () => join(tmpDir, 'userData', 'Partitions', 'test')
    })
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  })

  afterEach(() => {
    platformSpy.mockRestore()
    copyFileSyncMock.mockReset()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function denyCopiesFrom(sourcePath: string): void {
    copyFileSyncMock.mockImplementation((source: string) => {
      if (source === sourcePath) {
        throw errnoError('EPERM')
      }
    })
  }

  it('asks for Full Disk Access when macOS blocks the Chrome profile', async () => {
    const sourceCookiesPath = join(tmpDir, 'Chrome', 'Default', 'Network', 'Cookies')
    createChromiumCookieTestDatabase(sourceCookiesPath, [{ name: 'sid', value: 'v' }]).close()
    createChromiumCookieTestDatabase(
      join(tmpDir, 'userData', 'Partitions', 'test', 'Network', 'Cookies'),
      []
    ).close()
    denyCopiesFrom(sourceCookiesPath)
    const chrome: DetectedBrowser = {
      family: 'chrome',
      label: 'Google Chrome',
      cookiesPath: sourceCookiesPath,
      keychainService: 'Chrome Safe Storage',
      keychainAccount: 'Chrome',
      profiles: [{ name: 'Default', directory: 'Default' }],
      selectedProfile: 'Default'
    }

    const result = await importCookiesFromBrowser(chrome, 'persist:test')

    expect(result).toEqual({ ok: false, reason: macPrivacyDenialReason('Google Chrome') })
  })

  it('asks for Full Disk Access when macOS blocks the Firefox profile', async () => {
    const sourceCookiesPath = join(tmpDir, 'Firefox', 'cookies.sqlite')
    mkdirSync(dirname(sourceCookiesPath), { recursive: true })
    writeFileSync(sourceCookiesPath, '')
    denyCopiesFrom(sourceCookiesPath)
    const firefox: DetectedBrowser = {
      family: 'firefox',
      label: 'Firefox',
      cookiesPath: sourceCookiesPath,
      profiles: [{ name: 'default-release', directory: 'default-release' }],
      selectedProfile: 'default-release'
    }

    const result = await importCookiesFromBrowser(firefox, 'persist:test')

    expect(result).toEqual({ ok: false, reason: macPrivacyDenialReason('Firefox') })
  })

  it('keeps the close-the-browser hint for non-permission failures', () => {
    expect(sourceCopyFailureReason('Google Chrome', errnoError('EBUSY'))).toBe(
      'Could not copy Google Chrome cookies database. Try closing Google Chrome first.'
    )
  })
})
