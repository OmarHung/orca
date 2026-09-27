import { openDatabasePage } from './helpers/database-page'
import { seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

// The fork ships Traditional Chinese; this walks the main flow with the labels users see.
test('works end to end in Traditional Chinese', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage, 'zh-TW')
  await expect(orcaPage.getByText('新增資料庫連線，就能瀏覽結構和執行 SQL。')).toBeVisible()

  await orcaPage.getByRole('button', { name: '新增連線' }).first().click()
  const dialog = orcaPage.getByRole('dialog', { name: '新增連線' })
  await dialog.getByLabel('種類').click()
  await orcaPage.getByRole('option', { name: 'SQLite' }).click()
  await dialog.getByLabel('資料庫檔案').fill(filePath)
  await dialog.getByLabel('名稱').fill('商店')
  await dialog.getByRole('button', { name: '測試連線' }).click()
  await expect(dialog.getByText(/^已連線到 SQLite 3\./)).toBeVisible({ timeout: 20_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('zh-tw-connection-dialog.png') })
  await dialog.getByRole('button', { name: '儲存' }).click()
  await expect(dialog).toBeHidden()

  const tree = orcaPage.getByRole('tree', { name: '資料庫物件' })
  const connection = tree.getByRole('treeitem', { name: /^商店/ })
  await connection.dblclick()
  await expect(connection.getByRole('img', { name: '已連線' })).toBeVisible({ timeout: 20_000 })
  await tree.getByRole('treeitem', { name: 'main', exact: true }).dblclick()
  await tree.getByRole('treeitem', { name: 'people', exact: true }).click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: '開啟資料' }).click()

  await expect(orcaPage.getByText(/^3 列$/)).toBeVisible({ timeout: 20_000 })
  await orcaPage.getByRole('button', { name: '計算總列數' }).click()
  await expect(orcaPage.getByText('共 3 列', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByPlaceholder('例如 id > 100')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('zh-tw-table-data.png') })
})
