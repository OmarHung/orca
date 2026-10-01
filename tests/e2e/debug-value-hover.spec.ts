import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { launchCurrentFile } from './helpers/run-panel'

const PROGRAM = 'hover_demo.py'
const SOURCE = [
  'config = {"name": "orca", "size": 3}',
  'items = [10, 20, 30]',
  'print(config["name"], items[1])',
  ''
].join('\n')

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** On-screen box of `text` on the editor line containing `lineText` (Monaco splits lines into spans). */
async function textBox(
  editor: Locator,
  lineText: string,
  text: string
): Promise<{ left: number; right: number; y: number }> {
  const box = await editor.evaluate(
    (root, [wantedLine, wanted]) => {
      const line = [...root.querySelectorAll('.view-line')].find((element) =>
        element.textContent?.replace(/\u00a0/g, ' ').includes(wantedLine)
      )
      const lineContent = line?.textContent?.replace(/\u00a0/g, ' ') ?? ''
      const start = lineContent.indexOf(wanted)
      if (!line || start === -1) {
        return null
      }
      // Map the line offset onto the span text nodes that hold it.
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      let offset = 0
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0
        if (start >= offset && start < offset + length) {
          range.setStart(node, start - offset)
        }
        if (start + wanted.length > offset && start + wanted.length <= offset + length) {
          range.setEnd(node, start + wanted.length - offset)
        }
        offset += length
      }
      const rect = range.getBoundingClientRect()
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
    },
    [lineText, text]
  )
  expect(box).not.toBeNull()
  return box!
}

test.skip(!hasPython(), 'python3 is not installed')

test('hovering a name while paused shows a JetBrains-style expandable value', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-value-hover')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  writeFileSync(path.join(fixture.worktreePath, PROGRAM), SOURCE)

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()
  await orcaPage
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({
      has: orcaPage.locator('[data-file-explorer-row-name]').getByText(PROGRAM, { exact: true })
    })
    .click()
  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('items = [10, 20, 30]', { timeout: 25_000 })
  const lineThree = await editor.locator('.line-numbers').filter({ hasText: /^3$/ }).boundingBox()
  expect(lineThree).not.toBeNull()
  await orcaPage.mouse.click(lineThree!.x - 6, lineThree!.y + lineThree!.height / 2)

  const panel = orcaPage.getByTestId('debug-panel')
  await launchCurrentFile(orcaPage, 'debug')
  await expect(panel.getByTestId('debug-frames')).toContainText(`${PROGRAM}:3`, {
    timeout: 120_000
  })

  // Leave the paused line at the editor's bottom edge, right above the Debug panel.
  const separator = await orcaPage
    .getByRole('separator', { name: 'Resize bottom panel' })
    .boundingBox()
  expect(separator).not.toBeNull()
  const pausedLine = await textBox(editor, 'print(config', 'print')
  const separatorX = separator!.x + separator!.width / 2
  await orcaPage.mouse.move(separatorX, separator!.y + separator!.height / 2)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(separatorX, pausedLine.y + 30, { steps: 5 })
  await orcaPage.mouse.up()

  // Resting on a name shows its value with an expander instead of the language hover.
  const hover = orcaPage.getByTestId('debug-value-hover')
  const configBox = await textBox(editor, 'print(config', 'config')
  await orcaPage.mouse.move((configBox.left + configBox.right) / 2, configBox.y)
  await expect(hover).toBeVisible({ timeout: 10_000 })
  await expect(hover).toContainText("config={dict} {'name': 'orca', 'size': 3}")
  await expect(orcaPage.locator('.monaco-hover:visible')).toHaveCount(0)

  // Its value expands into members.
  const valueRow = hover.getByRole('button', { name: /^config/ })
  await valueRow.hover()
  await valueRow.click()
  await expect(valueRow).toHaveAttribute('aria-expanded', 'true')
  await expect(hover).toContainText(/'size'=(\{int\} )?3/)
  // Members past the editor's bottom edge float over the Debug panel instead of being cut off.
  const lastMember = hover.getByRole('button', { name: /^len\(\)/ })
  await expect(lastMember).toBeVisible()
  const lastMemberOnTop = await lastMember.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && element.contains(hit)
  })
  expect(lastMemberOnTop).toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('value-hover-expanded.png') })

  // It stays pinned while the pointer moves away, even across other names.
  const itemsBox = await textBox(editor, 'items = [10', 'items')
  await orcaPage.mouse.move((itemsBox.left + itemsBox.right) / 2, itemsBox.y)
  const variables = await panel.getByTestId('debug-variables').boundingBox()
  await orcaPage.mouse.move(
    variables!.x + variables!.width / 2,
    variables!.y + variables!.height / 2
  )
  await orcaPage.waitForTimeout(1_000)
  await expect(hover).toContainText("config={dict} {'name': 'orca', 'size': 3}")

  // Escape closes it.
  await orcaPage.keyboard.press('Escape')
  await expect(hover).toHaveCount(0)

  // A hovered selection is evaluated as written and can become a watch.
  const indexBox = await textBox(editor, 'print(config', 'items[1]')
  await orcaPage.mouse.move(indexBox.left + 1, indexBox.y)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(indexBox.right - 1, indexBox.y, { steps: 5 })
  await orcaPage.mouse.up()
  await orcaPage.mouse.move((indexBox.left + indexBox.right) / 2, indexBox.y + 1)
  await expect(hover).toContainText(/items\[1\]=(\{int\} )?20/, { timeout: 10_000 })
  await hover.getByRole('button', { name: 'Add to Watches' }).click()
  await expect(panel.getByTestId('debug-watches')).toContainText('items[1]')
  await expect(panel.getByTestId('debug-watches')).toContainText('20')

  // A click outside closes it.
  await panel.getByTestId('debug-variables').click()
  await expect(hover).toHaveCount(0)
})
