import { create } from 'zustand'

// Why localStorage: local folders belong to this device, like the open tabs and column layout.
const FOLDER_BY_HOST_KEY = 'orca.sftpLocalFolderByHost'
const DEFAULT_FOLDER_KEY = 'orca.sftpDefaultLocalFolder'

function readFolderByHost(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FOLDER_BY_HOST_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''
      )
    )
  } catch {
    return {}
  }
}

/** The local folder this host's SFTP tabs showed last. */
export function readHostLocalFolder(targetId: string): string | null {
  return readFolderByHost()[targetId] ?? null
}

export function saveHostLocalFolder(targetId: string, path: string): void {
  try {
    window.localStorage.setItem(
      FOLDER_BY_HOST_KEY,
      JSON.stringify({ ...readFolderByHost(), [targetId]: path })
    )
  } catch {
    // Storage can be unavailable; the host just opens the default folder next time.
  }
}

function readDefaultLocalFolder(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_FOLDER_KEY) || null
  } catch {
    return null
  }
}

type DefaultLocalFolderState = {
  /** Where hosts without a remembered local folder start; null means the home folder. */
  defaultFolder: string | null
  setDefaultFolder: (path: string | null) => void
}

export const useSftpDefaultLocalFolder = create<DefaultLocalFolderState>((set) => ({
  defaultFolder: readDefaultLocalFolder(),
  setDefaultFolder: (path) => {
    const folder = path?.trim() || null
    try {
      if (folder) {
        window.localStorage.setItem(DEFAULT_FOLDER_KEY, folder)
      } else {
        window.localStorage.removeItem(DEFAULT_FOLDER_KEY)
      }
    } catch {
      // Storage can be unavailable; the choice still lasts until the app restarts.
    }
    set({ defaultFolder: folder })
  }
}))
