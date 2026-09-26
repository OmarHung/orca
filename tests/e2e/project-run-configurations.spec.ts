import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
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

const LAUNCH_SETTINGS = `{
  // comments are allowed, as Rider and Visual Studio write them
  "profiles": {
    "MvcWeb": { "commandName": "Project" },
    "IIS Express": { "commandName": "IISExpress" }
  }
}`

async function openExplorer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await page.getByRole('button', { name: 'Explorer' }).click()
}

function explorerRow(page: Page, name: string) {
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]').getByText(name, { exact: true }) })
}

test('offers Build/Run/Publish for .NET and Node projects in the file tree and runs them in the project folder', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'project-run')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const root = fixture.worktreePath

  const web = path.join(root, 'web')
  mkdirSync(web)
  // Why arithmetic: the output must not match the echoed command line itself.
  writeFileSync(
    path.join(web, 'package.json'),
    JSON.stringify({
      name: 'web',
      private: true,
      scripts: { build: `node -e "console.log('built-' + 6 * 7 + ':' + process.cwd())"` }
    })
  )
  writeFileSync(path.join(web, 'package-lock.json'), '{}')

  const dotnet = path.join(root, 'Project2')
  mkdirSync(path.join(dotnet, 'Properties', 'PublishProfiles'), { recursive: true })
  writeFileSync(path.join(dotnet, 'Project2.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web" />')
  writeFileSync(path.join(dotnet, 'Properties', 'launchSettings.json'), LAUNCH_SETTINGS)
  writeFileSync(
    path.join(dotnet, 'Properties', 'PublishProfiles', 'FolderProfile.pubxml'),
    '<Project />'
  )

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, root)
  await openExplorer(orcaPage)

  // .NET: Build, Run per launch profile and Publish per publish profile, straight from the csproj folder.
  await explorerRow(orcaPage, 'Project2').click({ button: 'right' })
  await expect(orcaPage.getByRole('menuitem', { name: "Build 'Project2'" })).toBeVisible()
  await expect(orcaPage.getByRole('menuitem', { name: "Run 'Project2: MvcWeb'" })).toBeVisible()
  const publish = orcaPage.getByRole('menuitem', {
    name: "Publish 'Project2'…"
  })
  await expect(publish).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('dotnet-context-menu.png') })
  await publish.click()
  // Publishing asks first and shows the exact command.
  const dialog = orcaPage.getByRole('dialog').filter({ hasText: "Publish 'Project2'?" })
  await expect(dialog).toContainText(
    'dotnet publish Project2.csproj -p:PublishProfile=FolderProfile'
  )
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(orcaPage.getByTestId('run-configurations-trigger')).not.toContainText('Project2')

  // Node: the script runs with the project's package manager, inside the project folder.
  await explorerRow(orcaPage, 'web').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: "Build 'web'" }).click()
  const controls = orcaPage.getByTestId('run-configurations-session')
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
  await expect
    .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 20_000 })
    .toContain(`built-42:${realpathSync(web)}`)
  await expect(orcaPage.getByTestId('run-configurations-trigger')).toContainText('web: build')

  // The Run widget keeps it one click away, reusing the same terminal tab.
  await orcaPage.getByTestId('run-configurations-launch').click()
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
  const buildTabs = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const tabs = state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []
    return tabs.filter((tab) => tab.quickCommandLabel === 'web: build').length
  })
  expect(buildTabs).toBe(1)
  await orcaPage.screenshot({ path: testInfo.outputPath('node-build-done.png') })
})
