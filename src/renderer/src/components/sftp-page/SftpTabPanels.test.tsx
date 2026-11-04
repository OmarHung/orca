// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useRemoteSessionStore } from '../ssh-page/remote-session-store'
import { SftpTabPanels, type RemoteFilesTab } from './SftpTabPanels'

vi.mock('./SftpWorkbench', () => ({
  SftpWorkbench: ({
    target,
    isActive,
    onRemotePathChange
  }: {
    target: SshTarget
    isActive: boolean
    onRemotePathChange: (path: string) => void
  }) => (
    <button
      data-workbench={target.id}
      data-workbench-active={String(isActive)}
      onClick={() => onRemotePathChange('/var/log')}
    />
  )
}))

const targets: SshTarget[] = [
  { id: 'web', label: 'web-prod', host: '203.0.113.10', port: 22, username: 'deploy' },
  { id: 'db', label: 'db-prod', host: '203.0.113.20', port: 22, username: 'deploy' }
]
const targetsById = new Map(targets.map((target) => [target.id, target]))
const tabs: RemoteFilesTab[] = [
  { id: 'a', targetId: 'web', label: 'web-prod' },
  { id: 'b', targetId: 'db', label: 'db-prod' }
]

let container: HTMLDivElement
let root: Root

async function render(
  activeTabId: string | null,
  props: { tabs?: RemoteFilesTab[]; isPageVisible?: boolean } = {}
): Promise<void> {
  await act(async () =>
    root.render(
      <SftpTabPanels
        tabs={props.tabs ?? tabs}
        activeTabId={activeTabId}
        isPageVisible={props.isPageVisible ?? true}
        targetsById={targetsById}
        targetsStatus="ready"
      />
    )
  )
}

function workbenches(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-workbench]')].map(
    (node) => `${node.dataset.workbench}:${node.dataset.workbenchActive}`
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useRemoteSessionStore.setState({ sessions: {}, remotePathByTab: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('SftpTabPanels', () => {
  it('connects a tab only once its files are shown', async () => {
    await render('b')

    expect(workbenches()).toEqual(['db:true'])
  })

  it('connects nothing while the active tab shows only its terminal', async () => {
    await render(null)

    expect(workbenches()).toEqual([])
  })

  it('keeps a hidden tab mounted, so its folders survive switching', async () => {
    await render('a')
    await render('b')
    expect(workbenches()).toEqual(['web:false', 'db:true'])

    await render('a')

    expect(workbenches()).toEqual(['web:true', 'db:false'])
  })

  it('stops taking Finder drops while the page is hidden', async () => {
    await render('a', { isPageVisible: false })

    expect(workbenches()).toEqual(['web:false'])
  })

  it('records the folder a tab shows, for the tab strip', async () => {
    await render('a')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-workbench="web"]')?.click()
    )

    expect(useRemoteSessionStore.getState().remotePathByTab).toEqual({ a: '/var/log' })
  })

  it('says so when a tab’s host is gone', async () => {
    await render('a', { tabs: [{ id: 'a', targetId: 'removed', label: 'old-host' }] })

    expect(container.textContent).toContain('“old-host” is no longer in your SSH hosts.')
  })
})
