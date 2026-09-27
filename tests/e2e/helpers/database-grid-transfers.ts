import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'

const CLIPBOARD_KEY = '__orcaDatabaseClipboardWrites'

/**
 * Records clipboard writes instead of performing them, and answers save dialogs with
 * `<exportDir>/<suggested name>`, so a test never touches the real clipboard or a native dialog.
 */
export async function captureDatabaseTransfers(
  app: ElectronApplication,
  exportDir: string,
  separator: string
): Promise<void> {
  await app.evaluate(
    ({ dialog, ipcMain }, { exportDir, separator, clipboardKey }) => {
      const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) {
        throw new Error('ipcMain handler map unavailable')
      }
      const writes: string[] = []
      Reflect.set(globalThis, clipboardKey, writes)
      handlers.set('clipboard:writeText', async (_event: unknown, text: unknown) => {
        writes.push(String(text))
      })
      dialog.showSaveDialog = async (...args: unknown[]) => {
        const options: unknown = args.at(-1)
        const suggested: unknown =
          typeof options === 'object' && options !== null
            ? Reflect.get(options, 'defaultPath')
            : undefined
        return { canceled: false, filePath: `${exportDir}${separator}${String(suggested)}` }
      }
    },
    { exportDir, separator, clipboardKey: CLIPBOARD_KEY }
  )
}

/** The most recent text the app wrote to the (captured) clipboard. */
export async function lastClipboardWrite(app: ElectronApplication): Promise<string | undefined> {
  const writes = await app.evaluate((_electron, clipboardKey) => {
    const value: unknown = Reflect.get(globalThis, clipboardKey)
    return Array.isArray(value) ? value.map(String) : []
  }, CLIPBOARD_KEY)
  return writes.at(-1)
}

/** Presses on `from`, moves over the grid to `to` and releases, like a mouse drag selection. */
export async function dragBetween(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await from.boundingBox()
  const end = await to.boundingBox()
  if (!start || !end) {
    throw new Error('grid cells are not laid out')
  }
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
}

/** Right-clicks `target` and picks `item` from the grid context menu's `submenu`. */
export async function pickGridSubmenuItem(
  page: Page,
  target: Locator,
  submenu: 'Copy As' | 'Export Loaded Rows',
  item: string
): Promise<void> {
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: submenu }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}
