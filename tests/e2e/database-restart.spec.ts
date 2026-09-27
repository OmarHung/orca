import type { ElectronApplication } from '@stablyai/playwright-test'
import {
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'

const CONSOLE_SQL = 'select name from people order by id;'

test('restores the page, its console text and table tabs with their filter after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const cleanups: (() => Promise<void>)[] = []
  const filePath = seedShopDatabase((fn) => cleanups.push(fn))
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await openDatabasePage(first.page)
    await addSqliteConnection(first.page, filePath)
    const people = await expandPeople(first.page)
    await explorerMenu(
      first.page,
      first.page.getByRole('treeitem', { name: /^shop\.db/ }),
      'New Console'
    )
    await runInConsole(first.page, CONSOLE_SQL)
    await expect(first.page.getByRole('grid').getByRole('gridcell', { name: 'Cy' })).toBeVisible({
      timeout: 20_000
    })
    await people.dblclick()
    await first.page.getByLabel('WHERE').fill('id > 1')
    await first.page.getByLabel('WHERE').press('Enter')
    await expect(first.page.getByText(/^2 rows$/)).toBeVisible({ timeout: 20_000 })
    await first.page.getByRole('tab', { name: 'shop.db' }).click()
    await session.close(app)
    app = null

    const second = await session.launch()
    app = second.app
    const page = second.page
    await waitForSessionReady(page)
    await expect(page.getByRole('heading', { name: 'Database' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('tab', { name: 'shop.db' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.locator('.monaco-editor .view-lines')).toContainText(CONSOLE_SQL, {
      timeout: 20_000
    })

    // The table tab keeps its filter and reloads its data on its own.
    await page.getByRole('tab', { name: 'people' }).click()
    await expect(page.getByLabel('WHERE')).toHaveValue('id > 1')
    await expect(page.getByText(/^2 rows$/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('grid').getByRole('gridcell', { name: 'Ada' })).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath('database-restored.png') })
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    for (const cleanup of cleanups) {
      await cleanup()
    }
  }
})
