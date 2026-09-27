import type { Locator, Page } from '@stablyai/playwright-test'
import { addSqliteConnection, openDatabasePage } from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

const ADA_PROFILE = '{"lang":"en","tags":["math"]}'
const MIN_COLUMN_PX = 72
const KEYBOARD_STEP_PX = 16

async function dragBy(page: Page, handle: Locator, deltaX: number): Promise<void> {
  const box = await handle.boundingBox()
  if (!box) {
    throw new Error('resize handle is not laid out')
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y, { steps: 6 })
  await page.mouse.up()
}

async function width(locator: Locator): Promise<number> {
  return Math.round((await locator.boundingBox())?.width ?? 0)
}

/** True when the element's text is cut off (CSS `truncate` hides the overflow). */
async function isTruncated(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.scrollWidth > element.clientWidth)
}

test('resizes columns by dragging or keyboard and fits them on double-click', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await (await expandPeople(orcaPage)).dblclick()

  const grid = orcaPage.getByRole('grid')
  const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true })
  const header = (name: string) => grid.getByRole('columnheader', { name: new RegExp(`^${name}`) })
  const handle = (name: string) => grid.getByRole('separator', { name: `Resize column ${name}` })
  const profileText = cell(ADA_PROFILE).locator('span')
  await expect(cell('Ada')).toBeVisible({ timeout: 20_000 })

  // The first measurement already fits short values like this JSON.
  expect(await isTruncated(profileText)).toBe(false)

  // Dragging an edge resizes the header and every cell of that column together.
  const start = await width(header('name'))
  await dragBy(orcaPage, handle('name'), 120)
  await expect.poll(() => width(header('name'))).toBe(start + 120)
  expect(await width(cell('Bob'))).toBe(start + 120)

  await dragBy(orcaPage, handle('name'), -1000)
  await expect.poll(() => width(header('name'))).toBe(MIN_COLUMN_PX)

  // Arrow keys on a focused edge resize it without moving the cell selection.
  await cell('Ada').click()
  await handle('name').focus()
  await orcaPage.keyboard.press('ArrowRight')
  await orcaPage.keyboard.press('ArrowRight')
  await expect.poll(() => width(header('name'))).toBe(MIN_COLUMN_PX + 2 * KEYBOARD_STEP_PX)
  await expect(cell('Ada')).toHaveAttribute('aria-selected', 'true')

  // Double-clicking an edge fits the column to its widest value.
  await dragBy(orcaPage, handle('profile'), -1000)
  expect(await isTruncated(profileText)).toBe(true)
  await handle('profile').dblclick()
  await expect.poll(() => isTruncated(profileText)).toBe(false)
  const fitted = await width(header('profile'))

  // Re-querying the same table keeps hand-set widths.
  await orcaPage.getByLabel('WHERE').fill('id < 3')
  await orcaPage.getByLabel('WHERE').press('Enter')
  await expect(cell('Cy')).toBeHidden({ timeout: 20_000 })
  expect(await width(header('name'))).toBe(MIN_COLUMN_PX + 2 * KEYBOARD_STEP_PX)
  expect(await width(header('profile'))).toBe(fitted)
  await orcaPage.screenshot({ path: testInfo.outputPath('database-grid-columns.png') })
})
