// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeView: 'terminal',
  isWebClient: false,
  openDatabasePage: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { activeView: string }) => unknown) =>
    selector({ activeView: mocks.activeView })
}))

vi.mock('@/lib/web-client-location', () => ({
  isWebClientLocation: () => mocks.isWebClient
}))

vi.mock('./database-page-navigation', () => ({
  openDatabasePage: mocks.openDatabasePage
}))

import { DatabaseSidebarNavEntry } from './DatabaseSidebarNavEntry'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

function render(): HTMLButtonElement | null {
  act(() => {
    root.render(<DatabaseSidebarNavEntry />)
  })
  return container.querySelector('[data-testid="database-sidebar-nav"]')
}

describe('DatabaseSidebarNavEntry', () => {
  beforeEach(() => {
    mocks.activeView = 'terminal'
    mocks.isWebClient = false
    mocks.openDatabasePage.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the Database page when clicked', () => {
    const entry = render()

    expect(entry?.textContent).toBe('Database')
    expect(entry?.getAttribute('aria-current')).toBeNull()
    act(() => entry?.click())
    expect(mocks.openDatabasePage).toHaveBeenCalledTimes(1)
  })

  it('is marked as the current page while the Database page is open', () => {
    mocks.activeView = 'database'

    expect(render()?.getAttribute('aria-current')).toBe('page')
  })

  it('is hidden in the web client, which has no database support', () => {
    mocks.isWebClient = true

    expect(render()).toBeNull()
  })
})
