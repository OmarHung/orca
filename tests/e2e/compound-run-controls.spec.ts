import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

// Unique to each member's node command line.
const SHOP_PATTERN = "shop-' "
const ADMIN_PATTERN = "admin-' "
// Long-running like dev servers; Ctrl-C ends them.
const PACKAGE_JSON = JSON.stringify({
  private: true,
  scripts: {
    shop: 'node -e "console.log(\'shop-\' + 3 * 3); setInterval(() => {}, 1000)"',
    admin: 'node -e "console.log(\'admin-\' + 2 * 4); setInterval(() => {}, 1000)"'
  }
})

async function openRunMenu(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByTestId('run-configurations-trigger').first().click()
  await expect(page.getByRole('menu')).toBeVisible()
}

async function addMember(page: Page, name: string): Promise<void> {
  await page.getByTestId('compound-add-member').click()
  await page.getByTestId('compound-run-picker').getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('compound-run-picker')).toHaveCount(0)
}

/** Member processes on this host; hidden terminals render nothing, so the process table is the evidence. */
function memberPids(pattern: string): string[] {
  try {
    return execFileSync('pgrep', ['-f', pattern]).toString().trim().split('\n').filter(Boolean)
  } catch {
    // pgrep exits 1 when nothing matches.
    return []
  }
}

// Why: Stop sent before a shell has typed its startup command would only clear an empty prompt.
async function waitForMembers(running: { shop: boolean; admin: boolean }): Promise<void> {
  await expect
    .poll(() => memberPids(SHOP_PATTERN).length > 0, { timeout: 30_000 })
    .toBe(running.shop)
  await expect
    .poll(() => memberPids(ADMIN_PATTERN).length > 0, { timeout: 30_000 })
    .toBe(running.admin)
}

/** Waits out the menu's fade-in so the screenshot shows it as users see it. */
async function screenshotMenu(page: Page, path: string): Promise<void> {
  await expect(page.getByRole('menu')).toHaveCSS('opacity', '1')
  await page.screenshot({ path, clip: { x: 700, y: 0, width: 850, height: 360 } })
}

function menuRow(page: Page, label: string) {
  return page.getByTestId('run-widget-item').filter({ hasText: label })
}

test('manages each running member of a compound from the Run and Stop menus', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(process.platform === 'win32', 'Checks member processes with pgrep')
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'compound-run-controls')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  mkdirSync(path.join(fixture.worktreePath, 'web'))
  writeFileSync(path.join(fixture.worktreePath, 'web', 'package.json'), PACKAGE_JSON)

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)

  await openRunMenu(orcaPage)
  await orcaPage.getByTestId('run-widget-add-quick-command').click()
  const dialog = orcaPage.getByRole('dialog')
  await dialog.getByPlaceholder('Start dev server').fill('Run:all')
  await dialog.getByTestId('quick-command-action-compound').click()
  await addMember(orcaPage, 'shop')
  await addMember(orcaPage, 'admin')
  await dialog.getByRole('button', { name: /^Save/ }).click()
  await expect(dialog).toHaveCount(0)

  const trigger = orcaPage.getByTestId('run-configurations-trigger').first()
  const session = orcaPage.getByTestId('run-configurations-session')
  const stopControl = orcaPage.getByTestId('run-stop-control')
  await expect(trigger).toHaveText(/Run:all/)
  await orcaPage.getByTestId('run-configurations-launch').click()

  // Both members run; the compound stays selected although each opened its own terminal.
  await expect(stopControl).toHaveAttribute('data-count', '2', { timeout: 30_000 })
  await waitForMembers({ shop: true, admin: true })
  await expect(trigger).toHaveText(/Run:all/)
  await expect(session).toHaveAttribute('data-run-status', 'running')
  await expect(orcaPage.getByTestId('run-configurations-launch')).toHaveCount(0)

  // The Stop button lists each run, as in JetBrains, and stops just the one picked.
  await stopControl.getByTestId('run-stop').click()
  await expect(orcaPage.getByTestId('run-stop-item')).toHaveCount(2)
  await expect(orcaPage.getByTestId('run-stop-all')).toContainText('2')
  await screenshotMenu(orcaPage, testInfo.outputPath('stop-menu.png'))
  await orcaPage.getByRole('menuitem', { name: "Stop 'web: shop'" }).click()
  // Its terminal stays hidden; the finish still arrives through main's command-finished fact.
  await expect(stopControl).toHaveAttribute('data-count', '1', { timeout: 30_000 })
  await waitForMembers({ shop: false, admin: true })
  await expect(session).toHaveAttribute('data-run-status', 'running')

  // The Run menu shows which members are live and starts the stopped one again in place.
  await openRunMenu(orcaPage)
  await expect(menuRow(orcaPage, 'web: admin')).toHaveAttribute('data-run-active', 'true')
  await expect(menuRow(orcaPage, 'web: shop')).toHaveAttribute('data-run-active', 'false')
  await expect(menuRow(orcaPage, 'Run:all')).toHaveAttribute('data-run-active', 'true')
  await screenshotMenu(orcaPage, testInfo.outputPath('run-menu.png'))
  await menuRow(orcaPage, 'web: shop').hover()
  await menuRow(orcaPage, 'web: shop').getByTestId('run-widget-item-run').click()
  await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  await expect(stopControl).toHaveAttribute('data-count', '2', { timeout: 30_000 })
  await waitForMembers({ shop: true, admin: true })
  await expect(trigger).toHaveText(/Run:all/)

  // Stop on the compound's row stops every member and keeps the menu open.
  await openRunMenu(orcaPage)
  await menuRow(orcaPage, 'Run:all').getByTestId('run-widget-item-stop').click()
  await expect(menuRow(orcaPage, 'Run:all')).toHaveAttribute('data-run-active', 'false', {
    timeout: 30_000
  })
  await expect(orcaPage.getByRole('menu')).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await expect(stopControl).toHaveCount(0)
  await waitForMembers({ shop: false, admin: false })
  await expect(session).toHaveAttribute('data-run-status', 'idle')

  // Stop All ends everything at once.
  await orcaPage.getByTestId('run-configurations-launch').click()
  await expect(stopControl).toHaveAttribute('data-count', '2', { timeout: 30_000 })
  await waitForMembers({ shop: true, admin: true })
  await stopControl.getByTestId('run-stop').click()
  await orcaPage.getByTestId('run-stop-all').click()
  await expect(stopControl).toHaveCount(0, { timeout: 30_000 })
  await waitForMembers({ shop: false, admin: false })
})
