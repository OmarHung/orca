import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('the Traditional Chinese interface language renders Traditional, not Simplified, strings', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const previous = await orcaPage.evaluate(() => window.__store?.getState().settings?.uiLanguage)
  await orcaPage.evaluate(() => window.__store?.getState().updateSettings({ uiLanguage: 'zh-TW' }))

  try {
    // Sidebar navigation: 搜尋／任務／自動化 are the Taiwan forms of 搜索／任务／自动化.
    for (const label of ['搜尋', '任務', '自動化']) {
      await expect(orcaPage.getByText(label, { exact: true }).first()).toBeVisible({
        timeout: 15_000
      })
    }
    for (const simplified of ['搜索', '任务', '自动化']) {
      await expect(orcaPage.getByText(simplified, { exact: true })).toHaveCount(0)
    }
    await orcaPage.screenshot({ path: testInfo.outputPath('zh-tw-sidebar.png') })
  } finally {
    await orcaPage.evaluate(
      (language) => window.__store?.getState().updateSettings({ uiLanguage: language ?? 'system' }),
      previous
    )
  }
})
