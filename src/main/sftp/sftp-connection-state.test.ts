import { describe, expect, it } from 'vitest'
import type { SshConnectionState, SshConnectionStatus } from '../../shared/ssh-types'
import { toSftpConnectionState } from './sftp-connection-state'

function state(status: SshConnectionStatus, error: string | null = null): SshConnectionState {
  return { targetId: 'web', status, error, reconnectAttempt: 0, supportsFolderDownload: false }
}

describe('toSftpConnectionState', () => {
  it('passes the plain states through', () => {
    expect(toSftpConnectionState(state('connected'))).toEqual({
      targetId: 'web',
      status: 'connected',
      error: null
    })
    expect(toSftpConnectionState(state('disconnected')).status).toBe('disconnected')
  })

  it('counts every attempt in progress as connecting', () => {
    for (const status of ['connecting', 'reconnecting', 'deploying-relay'] as const) {
      expect(toSftpConnectionState(state(status)).status).toBe('connecting')
    }
  })

  it('reports every failure as failed, with its reason', () => {
    for (const status of ['auth-failed', 'reconnection-failed', 'error'] as const) {
      expect(toSftpConnectionState(state(status, 'Permission denied'))).toEqual({
        targetId: 'web',
        status: 'failed',
        error: 'Permission denied'
      })
    }
  })
})
