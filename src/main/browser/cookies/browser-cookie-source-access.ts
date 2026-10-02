import {
  browserCookieImportFailure,
  type BrowserCookieImportFailure
} from '../../../shared/browser-cookie-import-failure-copy'

// Why: macOS has no mandatory file locks, so EPERM on another app's profile is a privacy (TCC)
// denial that closing the browser cannot fix. On Windows EPERM can be a lock, so keep it darwin-only.
export function isMacPrivacyDenial(
  err: unknown,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'darwin' && err instanceof Error && 'code' in err && err.code === 'EPERM'
}

export function sourceCopyFailure(browser: string, err: unknown): BrowserCookieImportFailure {
  return browserCookieImportFailure(
    isMacPrivacyDenial(err) ? 'macFullDiskAccess' : 'databaseCopyFailed',
    { browser }
  )
}
