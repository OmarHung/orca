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

// Why arithmetic: the output must not match the echoed command line itself.
const PACKAGE_JSON = JSON.stringify({
  private: true,
  scripts: {
    migrate: 'node -e "setTimeout(() => console.log(\'mig-\' + (1 + 1)), 2000)"',
    dev: 'node -e "console.log(\'dev-\' + 3 * 3)"'
  }
})

async function tabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const tabs = state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []
    return tabs.map((tab) => tab.quickCommandLabel ?? '').filter(Boolean)
  })
}

async function openMenu(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByTestId('run-configurations-trigger').first().click()
  await expect(page.getByRole('menu')).toBeVisible()
}

async function addMember(page: Page, name: string): Promise<void> {
  await page.getByTestId('compound-add-member').click()
  await page.getByTestId('compound-run-picker').getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('compound-run-picker')).toHaveCount(0)
}

test('builds a sequential compound from detected runs and starts members in order', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(150_000)
  const fixture = createGoldenWorktree(testRepoPath, 'compound-sequential')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  mkdirSync(path.join(fixture.worktreePath, 'web'))
  writeFileSync(path.join(fixture.worktreePath, 'web', 'package.json'), PACKAGE_JSON)
  // Three levels down, like backend/src/Api, which a two-level scan used to miss.
  const apiDir = path.join(fixture.worktreePath, 'backend', 'src', 'Api')
  mkdirSync(apiDir, { recursive: true })
  writeFileSync(path.join(apiDir, 'Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web" />')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)

  // Add Quick Command → Compound: detected runs, migrate must exit 0 before dev starts.
  await openMenu(orcaPage)
  await orcaPage.getByTestId('run-widget-add-quick-command').click()
  const dialog = orcaPage.getByRole('dialog')
  await dialog.getByPlaceholder('Start dev server').fill('Run:All')
  await dialog.getByTestId('quick-command-action-compound').click()
  await orcaPage.getByTestId('compound-add-member').click()
  const picker = orcaPage.getByTestId('compound-run-picker')
  await expect(picker.getByRole('button', { name: 'backend/src/Api' })).toBeVisible()
  await expect(picker.getByRole('button', { name: '.NET Api 3' })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('compound-run-tree.png') })
  await orcaPage.keyboard.press('Escape')
  await addMember(orcaPage, 'migrate')
  await addMember(orcaPage, 'dev')
  await dialog.getByRole('combobox', { name: 'Then' }).click()
  await orcaPage.getByRole('option', { name: 'Wait until it exits 0' }).click()
  await orcaPage.screenshot({ path: testInfo.outputPath('compound-quick-command.png') })
  await dialog.getByRole('button', { name: /^Save/ }).click()
  await expect(dialog).toHaveCount(0)

  await expect(orcaPage.getByTestId('run-configurations-trigger').first()).toHaveText(/Run:All/)
  await orcaPage.getByTestId('run-configurations-launch').first().click()
  await expect.poll(() => tabLabels(orcaPage), { timeout: 30_000 }).toContain('web: migrate')
  expect(await tabLabels(orcaPage)).not.toContain('web: dev')
  await expect.poll(() => tabLabels(orcaPage), { timeout: 30_000 }).toContain('web: dev')

  // Edit Configurations shows the same members and lets a new compound pick detected runs.
  await openMenu(orcaPage)
  await orcaPage.getByTestId('run-configurations-edit').click()
  const editor = orcaPage.getByTestId('edit-run-configurations-dialog')
  await editor.getByTestId('run-configuration-list-item').filter({ hasText: 'Run:All' }).click()
  await expect(editor.getByTestId('compound-members-editor').getByRole('listitem')).toHaveCount(2)
  await editor.getByTestId('run-configuration-add-compound').click()
  await editor.getByTestId('compound-add-member').click()
  // Saved as configurations, the picked runs now appear under Saved rather than twice.
  await expect(
    orcaPage.getByTestId('compound-picker-saved').filter({ hasText: 'web: dev' })
  ).toHaveCount(1)
  await expect(
    orcaPage.getByTestId('compound-picker-run').filter({ hasText: /^dev$/ })
  ).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('edit-configurations-compound.png') })
})
