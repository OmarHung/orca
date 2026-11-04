// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useSftpTransfersStore } from '../sftp-page/sftp-transfers-store'
import { RemoteTransfersTray } from './RemoteTransfersTray'

vi.mock('../sftp-page/sftp-plan-actions', () => ({ cancelSftpTransfer: vi.fn() }))

const web: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}
const targetsById = new Map([[web.id, web]])

let container: HTMLDivElement
let root: Root

function begin(id: string, targetId: string): void {
  useSftpTransfersStore.getState().begin({
    id,
    direction: 'download',
    targetId,
    label: 'access.log',
    destinationDir: '~/Downloads'
  })
}

beforeEach(async () => {
  useSftpTransfersStore.setState({ transfers: [] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<RemoteTransfersTray targetsById={targetsById} />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('RemoteTransfersTray', () => {
  it('stays out of the way with no transfers', () => {
    expect(container.querySelector('[data-remote-transfers]')).toBeNull()
  })

  it('names the host of each transfer', async () => {
    await act(async () => begin('t1', 'web'))

    expect(container.querySelector('[data-sftp-transfer="t1"]')?.textContent).toContain('web-prod')
  })

  it('still reports a transfer whose host is gone', async () => {
    await act(async () => begin('t1', 'removed'))

    expect(container.querySelector('[data-sftp-transfer="t1"]')?.textContent).toContain(
      'access.log'
    )
  })

  it('folds its rows but keeps saying how many are running', async () => {
    await act(async () => {
      begin('t1', 'web')
      begin('t2', 'web')
    })
    const header = container.querySelector<HTMLButtonElement>('button[aria-expanded]')

    await act(async () => header?.click())

    expect(container.querySelector('[data-sftp-transfer]')).toBeNull()
    expect(header?.textContent).toContain('2 running')
  })

  it('offers to clear only once something has finished', async () => {
    await act(async () => begin('t1', 'web'))
    const clearButton = (): Element | undefined =>
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Clear finished')
      )
    expect(clearButton()).toBeUndefined()

    await act(async () => useSftpTransfersStore.getState().finish('t1', 'done'))

    expect(clearButton()).toBeDefined()
  })
})
