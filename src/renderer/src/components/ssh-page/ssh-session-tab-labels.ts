import { remoteFolderName } from '../sftp-page/sftp-paths'

/** Names the folder after the host, so tabs on one host can be told apart. */
function withRemoteFolder(label: string, remotePath: string | undefined): string {
  return remotePath ? `${label} · ${remoteFolderName(remotePath)}` : label
}

/**
 * What a session tab passes to TabBar. Both fields carry the folder because TabBar prefers
 * quickCommandLabel over title. Render-only: the stored tab keeps its plain host label.
 */
export function sshSessionTabLabels(
  label: string,
  quickCommandLabel: string | null,
  remotePath: string | undefined
): { title: string; quickCommandLabel: string | null } {
  return {
    title: withRemoteFolder(label, remotePath),
    quickCommandLabel: quickCommandLabel && withRemoteFolder(quickCommandLabel, remotePath)
  }
}
