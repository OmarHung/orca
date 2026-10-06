import { describe, expect, it, vi } from 'vitest'
import type { BrowserPage, BrowserWorkspace } from '../../../../shared/browser-workspace-types'

// The store pulls in the whole renderer; the planner under test never touches it.
vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))

import { mondayBrowserHandoff, planMondayLinkOpen } from './monday-browser-actions'

const ITEM_URL = 'https://autrontech.monday.com/boards/1/pulses/2'

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

describe('mondayBrowserHandoff', () => {
  it('keeps the page order and which page was showing', () => {
    const pages = [page('p1', ITEM_URL), page('p2', 'https://example.org/')]
    expect(mondayBrowserHandoff({ ...tab(), activePageId: 'p2' }, pages)).toEqual({
      urls: [ITEM_URL, 'https://example.org/'],
      activeIndex: 1
    })
  })

  it('falls back to the first page when the active one is unknown', () => {
    expect(
      mondayBrowserHandoff({ ...tab(), activePageId: 'gone' }, [page('p1', ITEM_URL)])
    ).toEqual({ urls: [ITEM_URL], activeIndex: 0 })
  })

  it('leaves out pages that are not web addresses', () => {
    expect(
      mondayBrowserHandoff(tab(), [page('p1', 'about:blank'), page('p2', ITEM_URL)]).urls
    ).toEqual([ITEM_URL])
  })

  it('uses the tab address when no page record is left', () => {
    expect(mondayBrowserHandoff(tab(), [])).toEqual({ urls: [ITEM_URL], activeIndex: 0 })
  })
})
