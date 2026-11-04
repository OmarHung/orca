import type { SftpOps } from './sftp-ops'
import type { SftpConnection } from './sftp-session-manager'
import { openSftpV3Session, type SftpV3Channel } from './sftp-v3-client'

type SftpSubsystemOptions = { wrapCommand: boolean; subsystem: boolean; keepAlive: boolean }

// Why keepAlive: a stalled link would otherwise leave every request waiting, with no way to cancel.
const SFTP_SUBSYSTEM: SftpSubsystemOptions = {
  wrapCommand: false,
  subsystem: true,
  keepAlive: true
}

/** The slice of SshConnection this needs. */
type SftpTransport = Pick<
  SftpConnection,
  'connect' | 'disconnect' | 'getReusableCredentials' | 'getState'
> & {
  usesSystemSshTransport(): boolean
  sftp(): Promise<SftpOps>
  exec(command: string, options: SftpSubsystemOptions): Promise<SftpV3Channel>
}

/**
 * A connection for the files pane. ssh2 can't carry a host that needs the system ssh (ProxyJump,
 * ProxyCommand, a hardware key), so there SFTP runs over `ssh -s <host> sftp` instead.
 */
export function toSftpConnection(connection: SftpTransport): SftpConnection {
  return {
    connect: () => connection.connect(),
    disconnect: () => connection.disconnect(),
    getReusableCredentials: () => connection.getReusableCredentials(),
    getState: () => connection.getState(),
    sftp: async () =>
      connection.usesSystemSshTransport()
        ? openSftpV3Session(await connection.exec('sftp', SFTP_SUBSYSTEM))
        : connection.sftp()
  }
}
