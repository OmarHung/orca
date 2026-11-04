import { beforeEach, describe, expect, it } from 'vitest'
import type { SftpConnectionStatus } from '../../../../shared/sftp-types'
import { useSftpConnectionStore } from './sftp-connection-store'

function state(targetId: string, status: SftpConnectionStatus) {
  return { targetId, status, error: null }
}

beforeEach(() => {
  useSftpConnectionStore.setState({ byTarget: {} })
})

describe('sftp connection store', () => {
  it('learns what main already knew from before this window was listening', () => {
    useSftpConnectionStore.getState().applySnapshot([state('web', 'connected')])

    expect(useSftpConnectionStore.getState().byTarget.web.status).toBe('connected')
  })

  it('keeps an event that arrived before the older snapshot', () => {
    useSftpConnectionStore.getState().apply(state('web', 'disconnected'))

    useSftpConnectionStore
      .getState()
      .applySnapshot([state('web', 'connected'), state('db', 'connected')])

    const { byTarget } = useSftpConnectionStore.getState()
    expect(byTarget.web.status).toBe('disconnected')
    expect(byTarget.db.status).toBe('connected')
  })
})
