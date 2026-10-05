import { startFakeMondayServer } from './helpers/fake-monday-server'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

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
    await orcaPage.getByRole('option', { name: /Project Cases/ }).click()
    await orcaPage.getByRole('option', { name: /Omars's Task/ }).click()
    // Docs share the boards query but hold no items.
    await expect(orcaPage.getByRole('option', { name: /遠端連線方式/ })).toHaveCount(0)
    await orcaPage.keyboard.press('Escape')

    const month = orcaPage.getByTestId('monday-month-view')
    const bar = month.getByTestId('monday-calendar-bar').filter({ hasText: '海發中心 零信任串接' })
    await expect(bar.first()).toBeVisible()
    // A due date after the bar ends gets its own flag; start → due draws a bar too.
    await expect(
      month.getByTestId('monday-calendar-flag').filter({ hasText: '拜爾 排程自動刪除報告' })
    ).toBeVisible()
    await expect(
      month.getByTestId('monday-calendar-bar').filter({ hasText: 'FC SEO 欄位開發建置' }).first()
    ).toBeVisible()
    // Shows the connected account's items (plus unassigned) until someone else is picked.
    await expect(orcaPage.getByTestId('monday-person-picker')).toContainText('Show: Omar')
    await expect(month.getByText('Vivian 的設計稿')).toHaveCount(0)
    await expect(orcaPage.getByText('1 without dates')).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-month.png') })

    await bar.first().click()
    const panel = orcaPage.getByTestId('monday-detail-panel')
    await expect(panel.getByRole('heading', { name: '海發中心 零信任串接' })).toBeVisible()
    await expect(panel.getByText('Due 2 day(s) before the timeline ends')).toBeVisible()
    await expect(panel.getByText('串接規格：SSO 走 OIDC，測試環境先行。')).toBeVisible()
    await expect(panel.getByText('請確認 /en 的導轉規則')).toBeVisible()
    await expect(panel.getByText('已移除路徑快取設定')).toBeVisible()
    await expect(panel.getByText('Replies (3)')).toBeVisible()
    await expect(panel.getByTestId('monday-update-entry')).toHaveCount(4)
    await expect(panel.getByRole('link', { name: '[Image]' })).toBeVisible()
    await expect(panel.getByText('測試環境驗證')).toBeVisible()
    expect(await orcaPage.evaluate(() => Reflect.get(window, '__mondayXss'))).toBeUndefined()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-detail.png') })

    await orcaPage.getByRole('radio', { name: 'Gantt' }).click()
    const gantt = orcaPage.getByTestId('monday-gantt-view')
    await expect(gantt.getByText("Omars's Task")).toBeVisible()
    await expect(gantt.getByRole('button', { name: '兆利 HTML 上稿' }).first()).toBeVisible()
    await expect(gantt.getByTestId('monday-gantt-flag').first()).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-gantt.png') })

    const picker = orcaPage.getByTestId('monday-person-picker')
    await picker.click()
    const vivian = orcaPage.getByRole('option', { name: /^Vivian/ })
    await expect(vivian).toBeVisible()
    // monday's AI agents are not people you assign work to.
    await expect(orcaPage.getByRole('option', { name: /Aurora/ })).toHaveCount(0)
    await vivian.click()
    await expect(picker).toContainText('Show: Vivian')
    await expect(gantt.getByRole('button', { name: 'Vivian 的設計稿' }).first()).toBeVisible()
    await expect(gantt.getByRole('button', { name: '海發中心 零信任串接' })).toHaveCount(0)
    await picker.click()
    await orcaPage.getByRole('option', { name: 'Everyone' }).click()
    await expect(gantt.getByRole('button', { name: '海發中心 零信任串接' }).first()).toBeVisible()
    await expect(gantt.getByRole('button', { name: 'Vivian 的設計稿' }).first()).toBeVisible()

    // The token only ever goes to the monday endpoint, from the main process.
    expect(new Set(server.tokens)).toEqual(new Set(['test-token']))
  } finally {
    await server.close()
  }
})
