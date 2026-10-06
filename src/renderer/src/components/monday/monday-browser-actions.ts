import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal'
import { isFloatingWorkspacePanelVisible } from '@/lib/floating-workspace-terminal-actions'
import { useAppStore } from '@/store'
import type { BrowserPage, BrowserWorkspace } from '../../../../shared/browser-workspace-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
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

export function closeMondayBrowser(): void {
  const state = useAppStore.getState()
  const tab = selectMondayBrowserTab(state)
  if (tab) {
    state.closeBrowserTab(tab.id)
  }
}

/** The pages to reopen elsewhere, in their order, and which one was showing. */
export function mondayBrowserHandoff(
  tab: BrowserWorkspace,
  pages: readonly BrowserPage[]
): { urls: string[]; activeIndex: number } {
  const webPages = pages.filter((page) => !page.docLocation && isWebUrl(page.url))
  if (webPages.length === 0) {
    return { urls: isWebUrl(tab.url) ? [tab.url] : [], activeIndex: 0 }
  }
  const activeIndex = webPages.findIndex((page) => page.id === tab.activePageId)
  return { urls: webPages.map((page) => page.url), activeIndex: Math.max(activeIndex, 0) }
}

/**
 * Reopens the page's browser in the floating workspace, which stays over every page. A guest
 * can't change workspace, so its pages load again there; the shared profile keeps the login.
 */
export async function moveMondayBrowserToFloating(): Promise<void> {
  const state = useAppStore.getState()
  const tab = selectMondayBrowserTab(state)
  if (!tab) {
    return
  }
  const { urls, activeIndex } = mondayBrowserHandoff(
    tab,
    state.browserPagesByWorkspace[tab.id] ?? []
  )
  const [firstUrl, ...restUrls] = urls
  if (!firstUrl) {
    return
  }
  const floating = state.createBrowserTab(FLOATING_TERMINAL_WORKTREE_ID, firstUrl, {
    activate: true,
    focusAddressBar: false,
    targetGroupId: state.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID],
    browserRuntimeEnvironmentId: null
  })
  const pageIds = [
    useAppStore.getState().browserPagesByWorkspace[floating.id]?.[0]?.id,
    ...restUrls.map(
      (url) => useAppStore.getState().createBrowserPage(floating.id, url, { activate: false })?.id
    )
  ]
  const activePageId = pageIds[activeIndex]
  if (activeIndex > 0 && activePageId) {
    useAppStore.getState().setActiveBrowserPage(floating.id, activePageId)
  }
  state.closeBrowserTab(tab.id)
  // Why enabled here: the user asked for the floating window, which a disabled feature never renders.
  if (state.settings?.floatingTerminalEnabled !== true) {
    await state.updateSettings({ floatingTerminalEnabled: true })
  }
  // Why deferred a frame: the panel only honors the toggle once the enabled flag has reached React.
  requestAnimationFrame(() => {
    if (!isFloatingWorkspacePanelVisible()) {
      window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_TERMINAL_EVENT))
    }
  })
}
