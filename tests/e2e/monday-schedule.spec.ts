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
    // "Only mine" hides other people's items; undated items are counted, not drawn.
    await expect(month.getByText('Bella 的設計稿')).toHaveCount(0)
    await expect(orcaPage.getByText('1 without dates')).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-month.png') })

    await bar.first().click()
    const panel = orcaPage.getByTestId('monday-detail-panel')
    await expect(panel.getByRole('heading', { name: '首頁改版' })).toBeVisible()
    await expect(panel.getByText('Due 2 day(s) before the timeline ends')).toBeVisible()
    await expect(panel.getByText('需求說明：先完成首頁，再做內頁。')).toBeVisible()
    await expect(panel.getByText('請確認首頁的連結')).toBeVisible()
    await expect(panel.getByText('已更新')).toBeVisible()
    await expect(panel.getByRole('link', { name: '[Image]' })).toBeVisible()
    await expect(panel.getByText('內部驗收')).toBeVisible()
    expect(await orcaPage.evaluate(() => Reflect.get(window, '__mondayXss'))).toBeUndefined()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-detail.png') })

    await orcaPage.getByRole('radio', { name: 'Gantt' }).click()
    const gantt = orcaPage.getByTestId('monday-gantt-view')
    await expect(gantt.getByText("Personal Tasks")).toBeVisible()
    await expect(gantt.getByRole('button', { name: '活動頁製作' }).first()).toBeVisible()
    await expect(gantt.getByTestId('monday-gantt-flag').first()).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('monday-gantt.png') })

    await orcaPage.getByLabel('Only mine').click()
    await expect(gantt.getByRole('button', { name: 'Bella 的設計稿' }).first()).toBeVisible()

    // The token only ever goes to the monday endpoint, from the main process.
    expect(new Set(server.tokens)).toEqual(new Set(['test-token']))
  } finally {
    await server.close()
  }
})
