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
import { getTerminalContent } from './helpers/terminal-pane-identity'

const LAUNCH_JSON = `{
  // VS Code writes comments here
  "version": "0.2.0",
  "configurations": [
    { "name": "Node app", "type": "node", "request": "launch", "program": "\${workspaceFolder}/app.js" },
    { "name": "Attach", "type": "node", "request": "attach", "port": 9229 },
  ]
}`

// Why arithmetic: the output must not match the echoed command line itself.
const ORCA_YAML = `runConfigurations:
  - name: Shared hello
    command: echo shared-$((1+1))
`

async function tabCountWithLabel(page: Page, label: string): Promise<number> {
  return page.evaluate((expected) => {
    const state = window.__store?.getState()
    const tabs = state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []
    return tabs.filter((tab) => tab.quickCommandLabel === expected).length
  }, label)
}

async function openMenu(page: Page): Promise<void> {
  // Why: clicking while the previous menu is still closing would toggle it shut again.
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByTestId('run-configurations-trigger').first().click()
  await expect(page.getByRole('menu')).toBeVisible()
}

async function addCommand(page: Page, name: string, command: string): Promise<void> {
  const dialog = page.getByTestId('edit-run-configurations-dialog')
  await dialog.getByTestId('run-configuration-add-command').click()
  await dialog.getByTestId('run-configuration-name').fill(name)
  await dialog.getByTestId('run-configuration-command').fill(command)
}

test('edits run configurations, chains Before launch steps, imports launch.json and gates orca.yaml ones behind trust', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(150_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-config-editor')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const root = fixture.worktreePath
  mkdirSync(path.join(root, '.vscode'))
  writeFileSync(path.join(root, '.vscode', 'launch.json'), LAUNCH_JSON)
  writeFileSync(path.join(root, 'orca.yaml'), ORCA_YAML)

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, root)

  // Edit Configurations: Serve runs only after Build exits 0.
  await openMenu(orcaPage)
  await orcaPage.getByTestId('run-configurations-edit').click()
  const dialog = orcaPage.getByTestId('edit-run-configurations-dialog')
  await expect(dialog).toBeVisible()
  await addCommand(orcaPage, 'Build', 'echo build-$((20+1))')
  await addCommand(orcaPage, 'Serve', 'echo serve-$((30+3))')
  await dialog.getByTestId('run-configuration-before-launch').getByRole('combobox').click()
  await orcaPage.getByRole('option', { name: 'Build' }).click()
  await orcaPage.screenshot({ path: testInfo.outputPath('edit-configurations.png') })
  await dialog.getByTestId('run-configurations-save').click()
  await expect(dialog).toHaveCount(0)

  await expect(orcaPage.getByTestId('run-configurations-trigger').first()).toHaveText(/Serve/)
  await orcaPage.getByTestId('run-configurations-launch').first().click()
  await expect.poll(() => tabCountWithLabel(orcaPage, 'Serve'), { timeout: 30_000 }).toBe(1)
  await expect
    .poll(() => getTerminalContent(orcaPage, 20_000), { timeout: 30_000 })
    .toContain('serve-33')
  expect(await tabCountWithLabel(orcaPage, 'Build')).toBe(1)

  // A failing Before launch step stops the chain.
  await openMenu(orcaPage)
  await orcaPage.getByTestId('run-configurations-edit').click()
  await dialog.getByTestId('run-configuration-list-item').filter({ hasText: 'Build' }).click()
  // Why a subshell: a bare `exit` in the reused shell would end the shell, not the command.
  await dialog.getByTestId('run-configuration-command').fill('echo failing; (exit 3)')
  // The configuration selected when saving becomes the current one, as in JetBrains.
  await dialog.getByTestId('run-configuration-list-item').filter({ hasText: 'Serve' }).click()
  await dialog.getByTestId('run-configurations-save').click()
  await expect(orcaPage.getByTestId('run-configurations-trigger').first()).toHaveText(/Serve/)
  await orcaPage.getByTestId('run-configurations-launch').first().click()
  await expect(orcaPage.getByText("Before launch 'Build' did not exit with 0 (3)")).toBeVisible({
    timeout: 30_000
  })

  // launch.json import adds the supported launch configurations.
  await openMenu(orcaPage)
  await orcaPage.getByTestId('run-configurations-import').click()
  await expect(orcaPage.getByText('Imported 1 new and 0 updated configurations')).toBeVisible()
  await openMenu(orcaPage)
  await expect(orcaPage.getByRole('menuitem', { name: 'Node app' })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('run-widget-menu.png') })

  // orca.yaml configurations need approval before they run.
  await orcaPage.getByRole('menuitem', { name: 'Shared hello' }).click()
  await orcaPage.getByTestId('run-configurations-launch').first().click()
  const trustDialog = orcaPage.getByRole('dialog').filter({ hasText: 'shared-$((1+1))' })
  await expect(trustDialog).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('orca-yaml-trust.png') })
  await trustDialog.getByRole('button', { name: "Don't run" }).click()
  expect(await tabCountWithLabel(orcaPage, 'Shared hello')).toBe(0)

  await orcaPage.getByTestId('run-configurations-launch').first().click()
  await orcaPage.getByRole('dialog').getByRole('button', { name: 'Run hooks' }).click()
  await expect.poll(() => tabCountWithLabel(orcaPage, 'Shared hello'), { timeout: 30_000 }).toBe(1)
  await expect
    .poll(() => getTerminalContent(orcaPage, 20_000), { timeout: 30_000 })
    .toContain('shared-2')
})
