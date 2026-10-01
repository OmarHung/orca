// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ContextMenuItem } from '../ui/context-menu'
import { TooltipProvider } from '../ui/tooltip'
import { EMPTY_SSH_HOST_GROUPS } from './ssh-host-groups'
import { sshHostGroupActions, useSshHostGroups } from './ssh-host-groups-store'
import { SshHostList } from './SshHostList'

const targets: SshTarget[] = [
  { id: 'web', label: 'web-prod-203.0.113.10', host: '203.0.113.10', port: 22, username: 'deploy' },
  { id: 'ci', label: 'ci-198.51.100.7', host: '198.51.100.7', port: 2222, username: 'ci' }
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  useSshHostGroups.setState({ data: EMPTY_SSH_HOST_GROUPS })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function renderList(props: {
  currentTargetId?: string | null
  onSelect?: (target: SshTarget) => void
  hostMenuItems?: (target: SshTarget) => React.ReactNode
}): Promise<void> {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <SshHostList
          targets={targets}
          currentTargetId={props.currentTargetId}
          onSelect={props.onSelect ?? vi.fn()}
          hostMenuItems={props.hostMenuItems}
        />
      </TooltipProvider>
    )
  })
}

function rows(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[data-ssh-host-row]')]
}

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function groupHeadings(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-ssh-host-group]')].map(
    (row) => row.textContent ?? ''
  )
}

async function typeQuery(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search hosts"]')
  if (!input) {
    throw new Error('search input not rendered')
  }
  await act(async () => setInputValue(input, value))
}

describe('SshHostList', () => {
  it('lists each host with its label and endpoint', async () => {
    await renderList({})

    expect(rows().map((row) => row.textContent)).toEqual([
      'web-prod-203.0.113.10deploy@203.0.113.10:22',
      'ci-198.51.100.7ci@198.51.100.7:2222'
    ])
  })

  it('reports the clicked host', async () => {
    const onSelect = vi.fn()
    await renderList({ onSelect })

    await act(async () => rows()[1].click())

    expect(onSelect).toHaveBeenCalledWith(targets[1])
  })

  it('marks the current host', async () => {
    await renderList({ currentTargetId: 'ci' })

    expect(rows().map((row) => row.dataset.current ?? null)).toEqual([null, 'true'])
  })

  it('puts the page actions for a host above the VPN choice in its right-click menu', async () => {
    const onOpen = vi.fn()
    await renderList({
      hostMenuItems: (target) => (
        <ContextMenuItem onSelect={() => onOpen(target.id)}>Open in new tab</ContextMenuItem>
      )
    })

    await act(async () => {
      rows()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="context-menu-item"]')]
    expect(items[0]?.textContent).toBe('Open in new tab')
    await act(async () => items[0]?.click())

    expect(onOpen).toHaveBeenCalledWith('ci')
  })

  it('filters by the search box and says when nothing matches', async () => {
    await renderList({})

    await typeQuery('2222')
    expect(rows().map((row) => row.dataset.sshHostRow)).toEqual(['ci'])

    await typeQuery('nothing-here')
    expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('No hosts match your search.')
  })
  it('shows hosts under their groups, with the rest under Ungrouped', async () => {
    await act(async () => sshHostGroupActions.create('Production', null, ['web']))
    await renderList({})

    expect(groupHeadings()).toEqual(['Production1'])
    expect(container.querySelector('[data-ssh-host-ungrouped]')?.textContent).toBe('Ungrouped1')
    expect(rows().map((row) => row.dataset.sshHostRow)).toEqual(['web', 'ci'])
  })

  it('folds a group when its heading is clicked, but not during a search', async () => {
    await act(async () => sshHostGroupActions.create('Production', null, ['web']))
    await renderList({})
    const heading = (): HTMLElement => container.querySelector('[data-ssh-host-group]')!

    await act(async () => heading().click())
    expect(heading().getAttribute('aria-expanded')).toBe('false')
    expect(rows().map((row) => row.dataset.sshHostRow)).toEqual(['ci'])

    await typeQuery('production')
    expect(rows().map((row) => row.dataset.sshHostRow)).toEqual(['web'])
    await act(async () => heading().click())
    expect(rows().map((row) => row.dataset.sshHostRow)).toEqual(['web'])
  })

  it('creates a group from the toolbar and explains a clashing name', async () => {
    await act(async () => sshHostGroupActions.create('Production', null))
    await renderList({})

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="New group"]')?.click()
    )
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Group name"]')!
    const submit = (): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Create'
      )!

    await act(async () => setInputValue(input, 'production'))
    expect(document.body.textContent).toContain('A group with this name is already here.')
    expect(submit().disabled).toBe(true)

    await act(async () => setInputValue(input, '  Staging  '))
    await act(async () => submit().click())
    expect(groupHeadings()).toEqual(['Production0', 'Staging0'])
  })

  it('offers Move to Group in a host’s right-click menu', async () => {
    await renderList({})

    await act(async () => {
      rows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })

    const subTrigger = document.querySelector('[data-slot="context-menu-sub-trigger"]')
    expect(subTrigger?.textContent).toBe('Move to Group')
  })
})
