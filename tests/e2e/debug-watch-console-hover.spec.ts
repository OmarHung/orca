import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const PROGRAM = 'loop.py'
const SOURCE = [
  'total = 0',
  'for i in range(6):',
  '    total += i',
  'print("total=" + str(total))',
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

test.skip(!hasPython(), 'python3 is not installed')

test('shows watches, console results, hover values and inline values while paused', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-inspect')
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
  await expect(editor).toContainText('total += i', { timeout: 25_000 })
  const lineThree = await editor.locator('.line-numbers').filter({ hasText: /^3$/ }).boundingBox()
  expect(lineThree).not.toBeNull()
  await orcaPage.mouse.click(lineThree!.x - 6, lineThree!.y + lineThree!.height / 2)

  // Watches are kept across sessions, so add one before debugging.
  const panel = orcaPage.getByTestId('debug-panel')
  await orcaPage.getByTestId('python-debug-file').click()
  await expect(panel.getByTestId('debug-frames')).toContainText(`${PROGRAM}:3`, {
    timeout: 120_000
  })
  const watches = panel.getByTestId('debug-watches')
  await watches.getByLabel('Add watch expression').fill('(i + 1) * 100')
  await watches.getByLabel('Add watch expression').press('Enter')
  await expect(watches).toContainText('100')

  // Inline values on the lines up to the paused one.
  await expect(editor.locator('.orca-debug-inline-value').first()).toBeVisible()
  // Values follow the adapter's variable order (debugpy lists i before total).
  await expect(editor).toContainText('i = 0, total = 0')

  // Console REPL evaluates in the paused frame.
  const input = panel.getByLabel('Evaluate expression')
  await input.fill('i + 40')
  await input.press('Enter')
  const debugConsole = panel.getByTestId('debug-console')
  await expect(debugConsole).toContainText('> i + 40')
  await expect(debugConsole).toContainText('40')

  // Hovering a name in the paused file shows its value.
  // Monaco splits a line into styled spans, so find the word's on-screen box with a text range.
  const wordBox = await editor.evaluate((root) => {
    const line = [...root.querySelectorAll('.view-line')].find((element) =>
      element.textContent?.replace(/\u00a0/g, ' ').includes('total += i')
    )
    const walker = document.createTreeWalker(line ?? root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf('total') ?? -1
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + 'total'.length)
        const rect = range.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
    }
    return null
  })
  expect(wordBox).not.toBeNull()
  await orcaPage.mouse.move(wordBox!.x, wordBox!.y)
  const hover = orcaPage.locator('.monaco-hover').filter({ hasText: /total.*= 0/ })
  await expect(hover).toBeVisible({ timeout: 10_000 })
  await expect(hover).toContainText('= 0')
  await orcaPage.screenshot({ path: testInfo.outputPath('inspect-paused.png') })

  // The next pause re-evaluates the watch for the new frame.
  await panel.getByRole('button', { name: 'Resume Program' }).click()
  await expect(watches).toContainText('200', { timeout: 30_000 })
  await panel.getByRole('button', { name: 'Stop' }).click()
})
