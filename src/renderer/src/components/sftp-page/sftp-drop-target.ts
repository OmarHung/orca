import type { SftpPaneId } from './sftp-columns-store'
import { isRemotePathWithin } from './sftp-paths'

/**
 * Where rows dragged from `from` land when dropped in `to`. Within the remote pane only a folder
 * row (or "..") takes them, and never one being dragged; across panes a folder row takes them,
 * else the folder the pane shows. Local-to-local moves are not offered.
 */
export function resolveSftpDropDir(
  from: SftpPaneId,
  sources: readonly string[],
  to: SftpPaneId,
  rowDir: string | null,
  shownPath: string | null
): string | null {
  if (from !== to) {
    return rowDir ?? shownPath
  }
  if (to === 'local' || rowDir === null) {
    return null
  }
  return sources.some((source) => isRemotePathWithin(rowDir, source)) ? null : rowDir
}
