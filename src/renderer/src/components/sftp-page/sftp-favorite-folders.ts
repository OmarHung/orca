import { create } from 'zustand'

// Why localStorage: favorites belong to this device, like the remembered local folders.
const FAVORITES_KEY = 'orca.sftpFavoriteFolders'

/** Local favorites shared by every connection; each connection also has its own local and remote lists. */
export const LOCAL_FAVORITES_SCOPE = 'local'

export function hostLocalFavoritesScope(targetId: string): string {
  return `local:${targetId}`
}

export function remoteFavoritesScope(targetId: string): string {
  return `remote:${targetId}`
}

/** One list a pane's star menu offers; `host` names the connection it belongs to, null when shared. */
export type SftpFavoriteList = { scope: string; host: string | null }

type FoldersByScope = Readonly<Record<string, readonly string[]>>

function readFoldersByScope(): FoldersByScope {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([scope, folders]) =>
        Array.isArray(folders)
          ? [[scope, folders.filter((f): f is string => typeof f === 'string' && f !== '')]]
          : []
      )
    )
  } catch {
    return {}
  }
}

function writeFoldersByScope(foldersByScope: FoldersByScope): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(foldersByScope))
  } catch {
    // Storage can be unavailable; the favorites still last until the app restarts.
  }
}

type FavoriteFoldersState = {
  foldersByScope: FoldersByScope
  add: (scope: string, path: string) => void
  remove: (scope: string, path: string) => void
}

function updateScope(
  foldersByScope: FoldersByScope,
  scope: string,
  folders: readonly string[]
): FoldersByScope {
  const next = { ...foldersByScope, [scope]: folders }
  writeFoldersByScope(next)
  return next
}

export const useSftpFavoriteFolders = create<FavoriteFoldersState>((set) => ({
  foldersByScope: readFoldersByScope(),
  add: (scope, path) =>
    set((state) => {
      const folders = state.foldersByScope[scope] ?? []
      return folders.includes(path)
        ? state
        : { foldersByScope: updateScope(state.foldersByScope, scope, [...folders, path]) }
    }),
  remove: (scope, path) =>
    set((state) => ({
      foldersByScope: updateScope(
        state.foldersByScope,
        scope,
        (state.foldersByScope[scope] ?? []).filter((folder) => folder !== path)
      )
    }))
}))
