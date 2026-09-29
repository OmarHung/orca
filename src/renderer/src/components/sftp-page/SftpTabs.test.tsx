// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { TooltipProvider } from '../ui/tooltip'
import { SftpTabPanels } from './SftpTabPanels'
import { SftpTabStrip } from './SftpTabStrip'
import { useSftpTabsStore } from './sftp-tabs-store'

vi.mock('./SftpWorkbench', () => ({
  SftpWorkbench: ({ target, isActive }: { target: SshTarget; isActive: boolean }) => (
    <div data-workbench={target.id} data-workbench-active={String(isActive)} />
  )
}))

const targets: SshTarget[] = [
  { id: 'web', label: 'web-prod', host: '203.0.113.10', port: 22, username: 'deploy' },
  { id: 'db', label: 'db-prod', host: '203.0.113.20', port: 22, username: 'deploy' }
]
const targetsById = new Map(targets.map((target) => [target.id, target]))

function Harness(): React.JSX.Element {
  const tabs = useSftpTabsStore((s) => s.tabs)
  const activeTabId = useSftpTabsStore((s) => s.activeTabId)
  const remotePathByTab = useSftpTabsStore((s) => s.remotePathByTab)
  const { activateTab, closeTab, openTab } = useSftpTabsStore.getState()
  return (
    <TooltipProvider>
      <SftpTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        folderByTab={remotePathByTab}
        describeTab={(tab) => tab.label}
        onActivate={activateTab}
        onClose={closeTab}
        onNewTab={() => undefined}
        onNewTabOnHost={(tab) => openTab({ id: tab.targetId, label: tab.label }, tab.id)}
      />
      <SftpTabPanels
        tabs={tabs}
        activeTabId={activeTabId}
        isPageVisible
        targetsById={targetsById}
        targetsStatus="ready"
      />
    </TooltipProvider>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  window.localStorage.clear()
  useSftpTabsStore.setState({ tabs: [], activeTabId: null, remotePathByTab: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function tabs(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
}

function workbenches(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-workbench]')].map(
    (node) => `${node.dataset.workbench}:${node.dataset.workbenchActive}`
  )
}

async function open(target: SshTarget): Promise<string> {
  let tabId = ''
  await act(async () => {
    tabId = useSftpTabsStore.getState().openTab(target)
  })
  return tabId
}

describe('SFTP tabs', () => {
  it('asks for a host when nothing is open', () => {
    expect(container.textContent).toContain('Pick a host to browse its files.')
  })

  it('keeps a hidden tab mounted, so its folders survive switching', async () => {
    await open(targets[0])
    await open(targets[1])
    expect(workbenches()).toEqual(['web:false', 'db:true'])

    await act(async () => tabs()[0].click())

    expect(workbenches()).toEqual(['web:true', 'db:false'])
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  })

  it('connects a restored tab only once it is shown', async () => {
    await act(async () => {
      useSftpTabsStore.setState({
        tabs: [
          { id: 'a', targetId: 'web', label: 'web-prod' },
          { id: 'b', targetId: 'db', label: 'db-prod' }
        ],
        activeTabId: 'b'
      })
    })

    expect(workbenches()).toEqual(['db:true'])
  })

  it('closes a tab from its close button and with a middle click', async () => {
    await open(targets[0])
    await open(targets[1])

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close tab db-prod"]')?.click()
    )
    expect(tabs().map((tab) => tab.textContent)).toEqual(['web-prod'])

    await act(async () => {
      tabs()[0].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    })
    expect(tabs()).toEqual([])
  })

  it('opens another tab on the same host, next to it, from the tab menu', async () => {
    await open(targets[0])
    await open(targets[1])

    await act(async () => {
      tabs()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    const item = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="context-menu-item"]')
    ].find((candidate) => candidate.textContent === 'New tab on this host')
    await act(async () => item?.click())

    expect(tabs().map((tab) => tab.textContent)).toEqual(['web-prod', 'web-prod', 'db-prod'])
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false'
    ])
  })

  it('names the folder after the host, so tabs on one host can be told apart', async () => {
    const first = await open(targets[0])
    await open(targets[0])

    await act(async () => useSftpTabsStore.getState().setTabRemotePath(first, 'logs'))

    expect(
      tabs().map((tab) => tab.querySelector('[data-tab-folder]')?.textContent ?? null)
    ).toEqual(['logs', null])
  })
})
