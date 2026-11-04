import type { SftpConnectionState, SftpConnectionStatus } from '../../shared/sftp-types'
import type { SshConnectionState, SshConnectionStatus } from '../../shared/ssh-types'

function toSftpStatus(status: SshConnectionStatus): SftpConnectionStatus {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'connecting':
    case 'reconnecting':
    case 'deploying-relay':
      return 'connecting'
    case 'disconnected':
      return 'disconnected'
    case 'auth-failed':
    case 'reconnection-failed':
    case 'error':
      return 'failed'
  }
}

/** What the file panes need to know of a connection; ssh's other states all mean one of these. */
export function toSftpConnectionState(state: SshConnectionState): SftpConnectionState {
  return { targetId: state.targetId, status: toSftpStatus(state.status), error: state.error }
}
