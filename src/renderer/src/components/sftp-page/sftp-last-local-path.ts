// Why localStorage: the local folder belongs to this device, like the open tabs and column layout.
const STORAGE_KEY = 'orca.sftpLastLocalPath'

/** The local folder the SFTP page showed last, so new and reopened tabs start there. */
export function readLastLocalPath(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function saveLastLocalPath(path: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, path)
  } catch {
    // Storage can be unavailable; the local pane just opens at home next time.
  }
}
