import type { Page } from '@stablyai/playwright-test'
import { startFakeMondayServer } from './helpers/fake-monday-server'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const MONDAY_BROWSER_WORKTREE_ID = 'global-monday-browser'
const FLOATING_TERMINAL_WORKTREE_ID = 'global-floating-terminal'

function mondayBrowserUrls(page: Page): Promise<string[]> {
  return page.evaluate(
    (worktreeId) =>
      (window.__store!.getState().browserTabsByWorktree[worktreeId] ?? []).map((tab) => tab.url),
    MONDAY_BROWSER_WORKTREE_ID
  )
}

function activeWorkspaceTabCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = window.__store!.getState()
    return state.activeWorktreeId
      ? (state.unifiedTabsByWorktree[state.activeWorktreeId] ?? []).length
      : 0
  })
}

function mondayBrowserLoading(page: Page): Promise<boolean> {
  return page.evaluate(
    (worktreeId) =>
      (window.__store!.getState().browserTabsByWorktree[worktreeId] ?? []).some(
        (tab) => tab.loading
      ),
    MONDAY_BROWSER_WORKTREE_ID
  )
}

test('connects monday, draws timeline bars with due flags, and opens an item from the calendar', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const server = await startFakeMondayServer()
  try {
    // Non-packaged builds honor this per request, so it can point at a server started now.
    await electronApp.evaluate((_electron, url) => {
      process.env.ORCA_MONDAY_API_URL_FOR_TESTS = url
    }, server.url)
    await waitForSessionReady(orcaPage)
    await orcaPage.evaluate(async () => {
      await window.__store!.getState().updateSettings({ uiLanguage: 'en' })
    })
    await orcaPage.getByTestId('monday-sidebar-nav').click()

    await orcaPage.getByLabel('Personal API token').fill('test-token')
    await orcaPage.getByRole('button', { name: 'Connect', exact: true }).click()
    await orcaPage.getByTestId('monday-board-picker').click()
    await orcaPage.getByRole('option', { name: /Client Projects/ }).click()
    await orcaPage.getByRole('option', { name: /Personal Tasks/ }).click()
    // Docs share the boards query but hold no items.
    await expect(orcaPage.getByRole('option', { name: /團隊文件/ })).toHaveCount(0)
    await orcaPage.keyboard.press('Escape')

    const month = orcaPage.getByTestId('monday-month-view')
    const bar = month.getByTestId('monday-calendar-bar').filter({ hasText: '首頁改版' })
    await expect(bar.first()).toBeVisible()
    // A due date after the bar ends gets its own flag; start → due draws a bar too.
    await expect(
      month.getByTestId('monday-calendar-flag').filter({ hasText: '月報匯出' })
    ).toBeVisible()
    await expect(
      month.getByTestId('monday-calendar-bar').filter({ hasText: 'SEO 欄位調整' }).first()
    ).toBeVisible()
    // Shows the connected account's items (plus unassigned) until someone else is picked.
    await expect(orcaPage.getByTestId('monday-person-picker')).toContainText('Show: Omar')
    await expect(month.getByText('Bella 的設計稿')).toHaveCount(0)
    await expect(orcaPage.getByText('1 without dates')).toBeVisible()
    // Items with no dates are listed beside the calendar; the status bar count hides and shows it.
    const undated = orcaPage.getByTestId('monday-undated-panel')
    await expect(undated.getByTestId('monday-undated-item')).toHaveText([/付款流程確認/])
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-month.png') })
    await orcaPage.getByTestId('monday-undated-toggle').click()
    await expect(undated).toHaveCount(0)
    await orcaPage.getByTestId('monday-undated-toggle').click()
    await undated.getByTestId('monday-undated-item').click()
    await expect(
      orcaPage.getByTestId('monday-detail-panel').getByRole('heading', { name: '付款流程確認' })
    ).toBeVisible()

    await bar.first().click()
    const panel = orcaPage.getByTestId('monday-detail-panel')
    await expect(panel.getByRole('heading', { name: '首頁改版' })).toBeVisible()
    await expect(panel.getByText('Due 2 day(s) before the timeline ends')).toBeVisible()
    await expect(panel.getByText('需求說明：先完成首頁，再做內頁。')).toBeVisible()
    // The task's Client CRM record gets its own card; its link back to the task is left out.
    const crm = panel.getByTestId('monday-linked-item')
    await expect(panel.getByText('Client CRM', { exact: true })).toBeVisible()
    await expect(crm.getByRole('button', { name: 'https://www.example.org/' })).toBeVisible()
    // Only the website shows until the card is expanded.
    await expect(crm.getByText('web-server-1')).toBeHidden()
    await crm.getByRole('button', { name: '範例官網' }).click()
    await expect(crm.getByText('web-server-1')).toBeVisible()
    await expect(crm).not.toContainText('link to Client Projects')
    await expect(panel.getByText('請確認首頁的連結')).toBeVisible()
    await expect(panel.getByText('已更新')).toBeVisible()
    await expect(panel.getByText('Replies (3)')).toBeVisible()
    await expect(panel.getByTestId('monday-update-entry')).toHaveCount(4)
    await expect(panel.getByRole('link', { name: '[Image]' })).toBeVisible()
    await expect(panel.getByText('內部驗收')).toBeVisible()
    expect(await orcaPage.evaluate(() => Reflect.get(window, '__mondayXss'))).toBeUndefined()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-detail.png') })

    // "Hand to AI" offers the recent workspaces and projects, and copies what an agent gets.
    // Substitute only the clipboard IPC; never touch the user's system clipboard.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('clipboard:writeText')
      ipcMain.handle('clipboard:writeText', (_event, text: string) => {
        process.env.ORCA_E2E_COPIED_TEXT = text
      })
    })
    await panel.getByTestId('monday-task-agent-trigger').click()
    const agentMenu = orcaPage.getByRole('menu').first()
    await expect(agentMenu.getByText('New agent in a workspace')).toBeVisible()
    await expect(
      agentMenu.getByRole('menuitem', { name: /New workspace in a project/ })
    ).toBeVisible()
    // Each workspace opens the agents its host can run.
    await agentMenu.getByRole('menuitem', { name: /e2e-secondary/ }).hover()
    const agentSubmenu = orcaPage.getByRole('menu').nth(1)
    await expect(agentSubmenu.getByRole('menuitem').first()).toBeVisible()
    // Why wait: the menus fade in, and a mid-animation screenshot shows them half drawn.
    await orcaPage.waitForTimeout(300)
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-agent-menu.png') })
    await agentMenu.getByRole('menuitem', { name: 'Copy the task for an agent' }).click()
    await expect
      .poll(() => electronApp.evaluate(() => process.env.ORCA_E2E_COPIED_TEXT ?? ''))
      .toContain('Task: 首頁改版')
    const handedOff = await electronApp.evaluate(() => process.env.ORCA_E2E_COPIED_TEXT ?? '')
    expect(handedOff).toContain('請確認首頁的連結 ticket (https://example.com/ticket)')
    expect(handedOff).toContain('[Image] https://acme.monday.com/protected_static/1/x.png')
    expect(handedOff).not.toContain('__mondayXss')

    await orcaPage.getByRole('radio', { name: 'Gantt' }).click()
    const gantt = orcaPage.getByTestId('monday-gantt-view')
    await expect(gantt.getByText('Personal Tasks')).toBeVisible()
    await expect(gantt.getByRole('button', { name: '活動頁製作' }).first()).toBeVisible()
    await expect(gantt.getByTestId('monday-gantt-flag').first()).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-gantt.png') })

    const picker = orcaPage.getByTestId('monday-person-picker')
    await picker.click()
    const bella = orcaPage.getByRole('option', { name: /^Bella/ })
    await expect(bella).toBeVisible()
    // monday's AI agents are not people you assign work to.
    await expect(orcaPage.getByRole('option', { name: /Assistant/ })).toHaveCount(0)
    await bella.click()
    await expect(picker).toContainText('Show: Bella')
    await expect(gantt.getByRole('button', { name: 'Bella 的設計稿' }).first()).toBeVisible()
    await expect(gantt.getByRole('button', { name: '首頁改版' })).toHaveCount(0)
    await picker.click()
    await orcaPage.getByRole('option', { name: 'Everyone' }).click()
    await expect(gantt.getByRole('button', { name: '首頁改版' }).first()).toBeVisible()
    await expect(gantt.getByRole('button', { name: 'Bella 的設計稿' }).first()).toBeVisible()

    // The status filter works on the items already read, so it costs no monday call.
    const requestsBeforeFilter = server.tokens.length
    const statusPicker = orcaPage.getByTestId('monday-status-picker')
    await statusPicker.click()
    await orcaPage.getByRole('option', { name: /^Stuck/ }).click()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-status-filter.png') })
    await orcaPage.keyboard.press('Escape')
    await expect(statusPicker).toContainText('Status: Stuck')
    await expect(gantt.getByRole('button', { name: '活動頁製作' }).first()).toBeVisible()
    await expect(gantt.getByRole('button', { name: '首頁改版' })).toHaveCount(0)
    await statusPicker.click()
    await orcaPage.getByRole('option', { name: 'All statuses' }).click()
    await orcaPage.keyboard.press('Escape')
    await expect(gantt.getByRole('button', { name: '首頁改版' }).first()).toBeVisible()
    expect(server.tokens.length).toBe(requestsBeforeFilter)

    // An edit on monday shows after leaving the page and coming back; no polling.
    server.renameItem('101', '首頁改版（已更新）')
    // Why wait: checks closer than 3s to the last read are folded into it.
    await orcaPage.waitForTimeout(3_200)
    await orcaPage.getByTestId('database-sidebar-nav').click()
    // The Database page loads lazily; leave for real before coming back.
    await expect(orcaPage.getByTestId('monday-page')).toHaveCount(0)
    await orcaPage.getByTestId('monday-sidebar-nav').click()
    await expect(
      orcaPage
        .getByTestId('monday-gantt-view')
        .getByRole('button', { name: '首頁改版（已更新）' })
        .first()
    ).toBeVisible()

    // Links open in Orca's browser docked beside the schedule, and it survives leaving the page.
    await orcaPage
      .getByTestId('monday-gantt-view')
      .getByRole('button', { name: '首頁改版（已更新）' })
      .first()
      .click()
    await orcaPage
      .getByTestId('monday-linked-item')
      .getByRole('button', { name: 'https://www.example.org/' })
      .click()
    const browserPanel = orcaPage.getByTestId('monday-browser-panel')
    await expect(browserPanel).toBeVisible()
    await expect.poll(() => mondayBrowserUrls(orcaPage)).toEqual(['https://www.example.org/'])
    await expect.poll(() => mondayBrowserLoading(orcaPage), { timeout: 15_000 }).toBe(false)
    // Page screenshots leave guest pixels out, so check the guest is laid out inside the panel.
    await expect(browserPanel.locator('webview')).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-browser.png') })
    await orcaPage.getByTestId('database-sidebar-nav').click()
    await expect(orcaPage.getByTestId('monday-page')).toHaveCount(0)
    await orcaPage.getByTestId('monday-sidebar-nav').click()
    await expect(browserPanel.locator('webview')).toBeVisible()
    await browserPanel.getByRole('button', { name: 'Close browser' }).click()
    await expect(browserPanel).toHaveCount(0)
    await expect.poll(() => mondayBrowserUrls(orcaPage)).toEqual([])

    // Cmd+W in the guest reaches the renderer as a close carrying the page id: it must close this
    // browser, never a tab of the project workspace hidden behind the page.
    await orcaPage
      .getByTestId('monday-linked-item')
      .getByRole('button', { name: 'https://www.example.org/' })
      .click()
    await expect(browserPanel).toBeVisible()
    const pageId = await orcaPage.evaluate(
      (worktreeId) =>
        window.__store!.getState().browserTabsByWorktree[worktreeId]?.[0]?.activePageId ?? '',
      MONDAY_BROWSER_WORKTREE_ID
    )
    const projectTabsBefore = await activeWorkspaceTabCount(orcaPage)
    expect(projectTabsBefore).toBeGreaterThan(0)
    await electronApp.evaluate(({ BrowserWindow }, sourceId) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('ui:closeActiveTab', { sourceId })
      }
    }, pageId)
    await expect(browserPanel).toHaveCount(0)
    expect(await activeWorkspaceTabCount(orcaPage)).toBe(projectTabsBefore)
    await expect(orcaPage.getByTestId('monday-page')).toBeVisible()

    // The browser moves to a separate OS window, never into the floating workspace.
    await orcaPage
      .getByTestId('monday-linked-item')
      .getByRole('button', { name: 'https://www.example.org/' })
      .click()
    await browserPanel.getByRole('button', { name: 'Open in separate window' }).click()
    await expect(browserPanel).toHaveCount(0)
    expect(await mondayBrowserUrls(orcaPage)).toEqual([])
    await expect
      .poll(
        () =>
          electronApp.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter(
                (contents) =>
                  contents.getType() !== 'webview' &&
                  contents.getURL().startsWith('https://www.example.org/')
              )
              // The window shares the browser profile, so the monday login carries over.
              .map((contents) => contents.session.storagePath?.includes('orca-browser') ?? false)
          ),
        { timeout: 15_000 }
      )
      .toEqual([true])
    await expect(
      orcaPage.locator('[data-floating-terminal-panel][aria-hidden="false"]')
    ).toHaveCount(0)
    expect(
      await orcaPage.evaluate(
        (worktreeId) => (window.__store!.getState().browserTabsByWorktree[worktreeId] ?? []).length,
        FLOATING_TERMINAL_WORKTREE_ID
      )
    ).toBe(0)

    // The token only ever goes to the monday endpoint, from the main process.
    expect(new Set(server.tokens)).toEqual(new Set(['test-token']))
  } finally {
    await server.close()
  }
})
