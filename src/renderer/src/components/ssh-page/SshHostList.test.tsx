// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ContextMenuItem } from '../ui/context-menu'
import { SshHostList } from './SshHostList'

const targets: SshTarget[] = [
  { id: 'web', label: 'web-prod-203.0.113.10', host: '203.0.113.10', port: 22, username: 'deploy' },
  { id: 'ci', label: 'ci-198.51.100.7', host: '198.51.100.7', port: 2222, username: 'ci' }
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
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
      <SshHostList
        targets={targets}
        currentTargetId={props.currentTargetId}
        onSelect={props.onSelect ?? vi.fn()}
        hostMenuItems={props.hostMenuItems}
      />
    )
  })
}

function rows(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[data-ssh-host-row]')]
}

async function typeQuery(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search hosts"]')
  if (!input) {
    throw new Error('search input not rendered')
  }
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
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
})
