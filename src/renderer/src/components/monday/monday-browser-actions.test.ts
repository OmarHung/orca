import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPage, BrowserWorkspace } from '../../../../shared/browser-workspace-types'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  openBrowserWindow: vi.fn(),
  openUrl: vi.fn(),
  defaultProfileForHost: vi.fn(),
  toast: { error: vi.fn() }
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
// The store pulls in the whole renderer; the code under test only reads state.
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('@/store/slices/browser/browser-host-state', () => ({
  getBrowserSessionProfileHostId: () => 'local',
  getDefaultBrowserProfileForHost: mocks.defaultProfileForHost
}))

import {
  openMondayLinkInWindow,
  planMondayBrowserPopOut,
  planMondayLinkOpen
} from './monday-browser-actions'

const ITEM_URL = 'https://acme.monday.com/boards/1/pulses/2'

function tab(): BrowserWorkspace {
  return {
    id: 'tab-1',
    worktreeId: 'global-monday-browser',
    url: ITEM_URL,
    title: 'Item',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 0
  }
}

function page(id: string, url: string): BrowserPage {
  return {
    id,
    workspaceId: 'tab-1',
    worktreeId: 'global-monday-browser',
    url,
    title: '',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 0
  }
}

describe('planMondayLinkOpen', () => {
  it('starts the page browser on the first link', () => {
    expect(planMondayLinkOpen(ITEM_URL, { systemBrowser: false }, null, [])).toEqual({
      kind: 'create-tab',
      url: ITEM_URL
    })
  })

  it('switches to a page already showing the link instead of opening it twice', () => {
    expect(
      planMondayLinkOpen(ITEM_URL, { systemBrowser: false }, tab(), [
        page('p1', 'https://example.org/'),
        page('p2', ITEM_URL)
      ])
    ).toEqual({ kind: 'focus-page', tabId: 'tab-1', pageId: 'p2' })
  })

  it('adds a page for a new link', () => {
    expect(
      planMondayLinkOpen('https://example.org/', { systemBrowser: false }, tab(), [
        page('p1', ITEM_URL)
      ])
    ).toEqual({ kind: 'add-page', tabId: 'tab-1', url: 'https://example.org/' })
  })

  it('sends the link to the system browser when asked', () => {
    expect(planMondayLinkOpen(ITEM_URL, { systemBrowser: true }, tab(), [])).toEqual({
      kind: 'system',
      url: ITEM_URL
    })
  })

  it('ignores anything that is not a web address', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url']) {
      expect(planMondayLinkOpen(url, { systemBrowser: false }, null, [])).toEqual({
        kind: 'ignore'
      })
    }
  })
})

describe('planMondayBrowserPopOut', () => {
  it('moves the page that is showing and keeps the others docked', () => {
    const pages = [page('p1', ITEM_URL), page('p2', 'https://example.org/')]
    expect(planMondayBrowserPopOut({ ...tab(), activePageId: 'p2' }, pages)).toEqual({
      url: 'https://example.org/',
      pageId: 'p2'
    })
  })

  it('closes the whole browser when its only page moves', () => {
    expect(
      planMondayBrowserPopOut({ ...tab(), activePageId: 'p1' }, [page('p1', ITEM_URL)])
    ).toEqual({ url: ITEM_URL, pageId: null })
  })

  it('falls back to the first page when the active one is unknown', () => {
    const pages = [page('p1', ITEM_URL), page('p2', 'https://example.org/')]
    expect(planMondayBrowserPopOut({ ...tab(), activePageId: 'gone' }, pages)).toEqual({
      url: ITEM_URL,
      pageId: 'p1'
    })
  })

  it('does nothing for a page that is not a web address', () => {
    expect(
      planMondayBrowserPopOut({ ...tab(), activePageId: 'p1' }, [page('p1', 'about:blank')])
    ).toBeNull()
  })

  it('uses the tab address when no page record is left', () => {
    expect(planMondayBrowserPopOut(tab(), [])).toEqual({ url: ITEM_URL, pageId: null })
  })
})

describe('openMondayLinkInWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openBrowserWindow.mockResolvedValue(true)
    mocks.defaultProfileForHost.mockReturnValue('work')
    vi.stubGlobal('window', {
      api: {
        monday: { openBrowserWindow: mocks.openBrowserWindow },
        shell: { openUrl: mocks.openUrl }
      }
    })
  })

  function stateWith(tabs: BrowserWorkspace[]): void {
    mocks.getState.mockReturnValue({
      browserTabsByWorktree: { 'global-monday-browser': tabs },
      browserPagesByWorkspace: {}
    })
  }

  it('opens the link straight in a separate window with the default profile', async () => {
    stateWith([])

    await openMondayLinkInWindow(ITEM_URL)

    expect(mocks.openBrowserWindow).toHaveBeenCalledWith({ url: ITEM_URL, profileId: 'work' })
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('shares the docked browser profile so its login carries over', async () => {
    stateWith([{ ...tab(), sessionProfileId: 'client' }])

    await openMondayLinkInWindow(ITEM_URL)

    expect(mocks.openBrowserWindow).toHaveBeenCalledWith({ url: ITEM_URL, profileId: 'client' })
  })

  it('sends the link to the system browser when asked', async () => {
    stateWith([])

    await openMondayLinkInWindow(ITEM_URL, { systemBrowser: true })

    expect(mocks.openUrl).toHaveBeenCalledWith(ITEM_URL)
    expect(mocks.openBrowserWindow).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a web address', async () => {
    stateWith([])

    await openMondayLinkInWindow('javascript:alert(1)')

    expect(mocks.openBrowserWindow).not.toHaveBeenCalled()
    expect(mocks.openUrl).not.toHaveBeenCalled()
  })

  it('tells the user when the window could not open', async () => {
    stateWith([])
    mocks.openBrowserWindow.mockResolvedValue(false)

    await openMondayLinkInWindow(ITEM_URL)

    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })
})
