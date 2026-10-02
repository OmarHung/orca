/** Remote paths are POSIX; local paths may use either separator (Windows). */

export function remoteParent(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

/** Last segment of a remote folder, "/" for the root. Splits on "/" only: a POSIX name may contain a backslash. */
export function remoteFolderName(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || '/'
}

export function remoteJoin(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

export function localParent(localPath: string): string {
  const trimmed = localPath.length > 1 ? localPath.replace(/[/\\]+$/, '') : localPath
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index < 0) {
    return trimmed
  }
  // Why: keep the root itself ("/" or "C:\") instead of collapsing it to "" or "C:".
  return index === 0 || /^[A-Za-z]:$/.test(trimmed.slice(0, index))
    ? trimmed.slice(0, index + 1)
    : trimmed.slice(0, index)
}

export function baseName(anyPath: string): string {
  const trimmed = anyPath.replace(/[/\\]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
}

/** Last segment of a local folder, "/" for the POSIX root and "C:" for a drive root. */
export function localFolderName(localPath: string): string {
  return baseName(localPath) || localPath
}

/** A single path segment the user may type for a new or renamed remote entry. */
export function isValidEntryName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed !== '' && trimmed !== '.' && trimmed !== '..' && !trimmed.includes('/')
}

/** Names of a typed new folder path ("a/b/c/") below the current folder; null if one is unusable. */
export function splitNewFolderPath(value: string): string[] | null {
  const trimmed = value.trim()
  const names = trimmed
    .split('/')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  return !trimmed.startsWith('/') && names.length > 0 && names.every(isValidEntryName)
    ? names
    : null
}

/** Resolves a typed remote path, absolute or relative to `base`, collapsing "." and "..". */
export function resolveRemotePath(base: string, input: string): string {
  const trimmed = input.trim()
  const joined = trimmed.startsWith('/') ? trimmed : `${base}/${trimmed}`
  const segments: string[] = []
  for (const segment of joined.split('/')) {
    if (segment === '..') {
      segments.pop()
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment)
    }
  }
  return `/${segments.join('/')}`
}

/** True when `candidate` is `folder` itself or anywhere below it. */
export function isRemotePathWithin(candidate: string, folder: string): boolean {
  return candidate === folder || candidate.startsWith(folder === '/' ? '/' : `${folder}/`)
}
