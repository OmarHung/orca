import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
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

async function gutterPoint(editor: Locator, line: number): Promise<{ x: number; y: number }> {
  const box = await editor
    .locator('.line-numbers')
    .filter({ hasText: new RegExp(`^${line}$`) })
    .boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x - 6, y: box!.y + box!.height / 2 }
}

async function editBreakpoint(
  page: Page,
  editor: Locator,
  line: number,
  field: 'Condition' | 'Log message',
  value: string
): Promise<void> {
  const point = await gutterPoint(editor, line)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const form = page.getByTestId('breakpoint-editor')
  await expect(form).toBeVisible()
  await form.getByLabel(field).fill(value)
  await form.getByRole('button', { name: 'Done' }).click()
  await expect(form).toHaveCount(0)
}

test('pauses only when a condition holds and logs without pausing at a logpoint', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-conditions')
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

  const lineThree = await gutterPoint(editor, 3)
  await orcaPage.mouse.click(lineThree.x, lineThree.y)
  await editBreakpoint(orcaPage, editor, 3, 'Condition', 'i == 4')
  await expect(editor.locator('.orca-debug-breakpoint-conditional')).toHaveCount(1)
  // Right-clicking an empty line adds the breakpoint and opens its editor in one step.
  await editBreakpoint(orcaPage, editor, 4, 'Log message', 'at end total={total}')
  await expect(editor.locator('.orca-debug-logpoint')).toHaveCount(1)

  await orcaPage.getByTestId('python-debug-file').click()
  const panel = orcaPage.getByTestId('debug-panel')
  const variables = panel.getByTestId('debug-variables')
  // Why the long timeout: the first run downloads debugpy.
  await expect(panel.getByTestId('debug-frames')).toContainText(`${PROGRAM}:3`, {
    timeout: 120_000
  })
  // Paused on the fifth pass (i == 4), not the first.
  await expect(variables.locator('button', { hasText: /^i\s*=/ })).toContainText('4')
  await orcaPage.screenshot({ path: testInfo.outputPath('conditional-pause.png') })

  await panel.getByRole('button', { name: 'Resume Program' }).click()
  const debugConsole = panel.getByTestId('debug-console')
  await expect(debugConsole).toContainText('at end total=15', { timeout: 30_000 })
  await expect(debugConsole).toContainText('total=15')
  await expect(panel).toContainText(`${PROGRAM} finished`, { timeout: 30_000 })

  await panel.getByRole('tab', { name: 'Breakpoints' }).click()
  const list = panel.getByTestId('debug-breakpoints')
  await expect(list).toContainText(`${PROGRAM}:3`)
  await expect(list).toContainText('i == 4')
  await expect(list).toContainText('logs at end total={total}')
  await expect(panel.getByTestId('debug-exception-filters')).toContainText(/Uncaught|Raised/)
  await orcaPage.screenshot({ path: testInfo.outputPath('breakpoints-tab.png') })
})
