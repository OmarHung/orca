// Why: macOS has no mandatory file locks, so EPERM on another app's profile is a privacy (TCC)
// denial that closing the browser cannot fix. On Windows EPERM can be a lock, so keep it darwin-only.
export function isMacPrivacyDenial(
  err: unknown,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'darwin' && err instanceof Error && 'code' in err && err.code === 'EPERM'
}

export function macPrivacyDenialReason(browserLabel: string): string {
  return `macOS denied access to ${browserLabel} cookies. Grant Full Disk Access to Orca in System Settings → Privacy & Security → Full Disk Access, then restart Orca.`
}

export function sourceCopyFailureReason(browserLabel: string, err: unknown): string {
  return isMacPrivacyDenial(err)
    ? macPrivacyDenialReason(browserLabel)
    : `Could not copy ${browserLabel} cookies database. Try closing ${browserLabel} first.`
}
