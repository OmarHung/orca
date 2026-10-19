import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  getBrowserSessionProfileHostId,
  getDefaultBrowserProfileForHost
} from '@/store/slices/browser/browser-host-state'
import type { AppState } from '@/store/types'
import type { BrowserPage, BrowserWorkspace } from '../../../../shared/browser-workspace-types'
import { MONDAY_BROWSER_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'

export type MondayLinkPlan =
  | { kind: 'ignore' }
  | { kind: 'system'; url: string }
  | { kind: 'create-tab'; url: string }
  | { kind: 'focus-page'; tabId: string; pageId: string }
  | { kind: 'add-page'; tabId: string; url: string }

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Where a link opens: the page's own browser, reusing a page already showing it, or the OS browser. */
export function planMondayLinkOpen(
  url: string,
  options: { systemBrowser: boolean },
  tab: BrowserWorkspace | null,
  pages: readonly BrowserPage[]
): MondayLinkPlan {
  if (!isWebUrl(url)) {
    return { kind: 'ignore' }
  }
  if (options.systemBrowser) {
    return { kind: 'system', url }
  }
  if (!tab) {
    return { kind: 'create-tab', url }
  }
  const open = pages.find((page) => page.url === url)
  return open
    ? { kind: 'focus-page', tabId: tab.id, pageId: open.id }
    : { kind: 'add-page', tabId: tab.id, url }
}

/** The page shows one browser workspace; its pages are the browser's own tabs. */
export function selectMondayBrowserTab(state: {
  browserTabsByWorktree: Record<string, BrowserWorkspace[]>
}): BrowserWorkspace | null {
  return state.browserTabsByWorktree[MONDAY_BROWSER_WORKTREE_ID]?.[0] ?? null
}

/** Shift (the system-browser escape hatch elsewhere in Orca) sends the link to the OS browser. */
export function openMondayLink(url: string, options: { systemBrowser?: boolean } = {}): void {
  const state = useAppStore.getState()
  const tab = selectMondayBrowserTab(state)
  const plan = planMondayLinkOpen(
    url,
    { systemBrowser: options.systemBrowser === true },
    tab,
    tab ? (state.browserPagesByWorkspace[tab.id] ?? []) : []
  )
  switch (plan.kind) {
    case 'ignore':
      return
    case 'system':
      void window.api.shell.openUrl(plan.url)
      return
    case 'create-tab':
      state.createBrowserTab(MONDAY_BROWSER_WORKTREE_ID, plan.url, {
        activate: true,
        focusAddressBar: false
      })
      return
    case 'focus-page':
      state.setActiveBrowserPage(plan.tabId, plan.pageId)
      return
    case 'add-page':
      state.createBrowserPage(plan.tabId, plan.url, { activate: true })
  }
}

/** The login a separate window shares: the docked browser's profile, else the one a new tab would get. */
function mondayWindowProfileId(state: AppState): string | null {
  const tab = selectMondayBrowserTab(state)
  if (tab) {
    return tab.sessionProfileId ?? null
  }
  return getDefaultBrowserProfileForHost(
    state,
    getBrowserSessionProfileHostId(state, MONDAY_BROWSER_WORKTREE_ID, undefined)
  )
}

async function openInSeparateWindow(url: string, profileId: string | null): Promise<boolean> {
  const opened = await window.api.monday.openBrowserWindow({ url, profileId })
  if (!opened) {
    toast.error(translate('monday.browser.openInWindowFailed', 'Could not open a separate window'))
  }
  return opened
}

/** Opens the link in a window of its own, skipping the docked browser; Shift sends it to the OS browser. */
export async function openMondayLinkInWindow(
  url: string,
  options: { systemBrowser?: boolean } = {}
): Promise<void> {
  if (!isWebUrl(url)) {
    return
  }
  if (options.systemBrowser) {
    void window.api.shell.openUrl(url)
    return
  }
  await openInSeparateWindow(url, mondayWindowProfileId(useAppStore.getState()))
}

export function closeMondayBrowser(): void {
  const state = useAppStore.getState()
  const tab = selectMondayBrowserTab(state)
  if (tab) {
    state.closeBrowserTab(tab.id)
  }
}

/** The page to move into a window of its own; a null pageId means it was the browser's last page. */
export function planMondayBrowserPopOut(
  tab: BrowserWorkspace,
  pages: readonly BrowserPage[]
): { url: string; pageId: string | null } | null {
  if (pages.length === 0) {
    return isWebUrl(tab.url) ? { url: tab.url, pageId: null } : null
  }
  const active = pages.find((page) => page.id === tab.activePageId) ?? pages[0]
  if (active.docLocation || !isWebUrl(active.url)) {
    return null
  }
  return { url: active.url, pageId: pages.length > 1 ? active.id : null }
}

/**
 * Moves the page that is showing into a separate OS window, which no workspace panel can absorb.
 * A guest can't change window, so the page loads again there; the shared profile keeps the login.
 */
export async function openMondayBrowserInWindow(): Promise<void> {
  const state = useAppStore.getState()
  const tab = selectMondayBrowserTab(state)
  if (!tab) {
    return
  }
  const plan = planMondayBrowserPopOut(tab, state.browserPagesByWorkspace[tab.id] ?? [])
  if (!plan) {
    return
  }
  if (!(await openInSeparateWindow(plan.url, tab.sessionProfileId ?? null))) {
    return
  }
  const latest = useAppStore.getState()
  if (plan.pageId) {
    latest.closeBrowserPage(plan.pageId)
  } else {
    latest.closeBrowserTab(tab.id)
  }
}
