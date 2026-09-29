// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { SshTargetList } from './SshTargetList'

const targets: SshTarget[] = [
  { id: 'web', label: 'web-prod-203.0.113.10', host: '203.0.113.10', port: 22, username: 'deploy' },
  { id: 'demo', label: 'demo-1-198.51.100.20', host: '198.51.100.20', port: 22, username: 'dev' },
  { id: 'aws', label: 'aws-192.0.2.44', host: 'ec2-192-0-2-44', port: 22, username: 'ubuntu' }
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

async function renderList(list: SshTarget[] = targets): Promise<void> {
  await act(async () => {
    root.render(
      <SshTargetList
        targets={list}
        renderTarget={(target) => <div data-testid="card">{target.label}</div>}
      />
    )
  })
}

function searchInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search targets"]')
  if (!input) {
    throw new Error('search input not rendered')
  }
  return input
}

async function typeQuery(value: string): Promise<void> {
  const input = searchInput()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function visibleLabels(): string[] {
  return [...container.querySelectorAll('[data-testid="card"]')].map((el) => el.textContent ?? '')
}

describe('SshTargetList', () => {
  it('shows every target under a search box', async () => {
    await renderList()

    expect(searchInput().value).toBe('')
    expect(visibleLabels()).toEqual(targets.map((t) => t.label))
  })

  it('narrows the list as the user types', async () => {
    await renderList()

    await typeQuery('ubuntu')

    expect(visibleLabels()).toEqual(['aws-192.0.2.44'])
  })

  it('says so when nothing matches, and recovers when the query is cleared', async () => {
    await renderList()

    await typeQuery('no-such-host')
    expect(visibleLabels()).toEqual([])
    expect(container.textContent).toContain('No SSH targets match your search.')

    await typeQuery('')
    expect(visibleLabels()).toHaveLength(targets.length)
  })

  it('keeps the query applied when the target list refreshes', async () => {
    await renderList()
    await typeQuery('demo')

    await renderList([...targets, { ...targets[1], id: 'demo-2', label: 'demo-2-198.51.100.21' }])

    expect(visibleLabels()).toEqual(['demo-1-198.51.100.20', 'demo-2-198.51.100.21'])
  })
})
