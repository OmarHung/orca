import type { Page } from '@playwright/test'

/** Output of the run the Run panel shows; empty while the panel is closed or has no run. */
export async function getRunPanelTerminalContent(page: Page, charLimit = 4000): Promise<string> {
  return page.evaluate((limit) => {
    const tabId = document
      .querySelector('[data-testid="run-panel-terminal"]')
      ?.getAttribute('data-run-tab-id')
    const manager = tabId ? window.__paneManagers?.get(tabId) : undefined
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    return (pane?.serializeAddon?.serialize?.() ?? '').slice(-limit)
  }, charLimit)
}

/** How many of the run's terminals the tab strip shows; the Run panel owns them, so 0. */
export async function runTerminalsInTabStrip(page: Page, label: string): Promise<number> {
  return page.evaluate((expected) => {
    const state = window.__store?.getState()
    const runTabIds = (state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? [])
      .filter((tab) => tab.quickCommandLabel === expected)
      .map((tab) => tab.id)
    return runTabIds.filter((tabId) =>
      document.querySelector(`[data-testid="sortable-tab"][data-tab-id="${CSS.escape(tabId)}"]`)
    ).length
  }, label)
}
