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

/** A single path segment the user may type for a new or renamed remote entry. */
export function isValidEntryName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed !== '' && trimmed !== '.' && trimmed !== '..' && !trimmed.includes('/')
}
