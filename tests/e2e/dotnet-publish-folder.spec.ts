import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

test.skip(!hasDotnet(), 'the dotnet SDK is not installed')

function explorerRow(page: Page, name: string) {
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]').getByText(name, { exact: true }) })
}

async function openPublishDialog(page: Page) {
  await explorerRow(page, 'Demo').click({ button: 'right' })
  await page.getByRole('menuitem', { name: "Publish 'Demo'…" }).click()
  const dialog = page.getByTestId('dotnet-publish-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test('publishes a .NET project to a chosen folder and keeps it as a run configuration', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = createGoldenWorktree(testRepoPath, 'dotnet-publish')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const root = fixture.worktreePath
  const project = path.join(root, 'Demo')
  execFileSync('dotnet', ['new', 'console', '-n', 'Demo', '-o', project], {
    stdio: 'pipe',
    timeout: 120_000
  })
  const framework = /<TargetFramework>([^<]+)</.exec(
    readFileSync(path.join(project, 'Demo.csproj'), 'utf8')
  )?.[1]

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, root)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()

  // Like Rider, the target location starts at the project's bin/Release/<tfm>/publish.
  const dialog = await openPublishDialog(orcaPage)
  const outputDir = dialog.getByTestId('dotnet-publish-output-dir')
  await expect(outputDir).toHaveValue(`Demo/bin/Release/${framework}/publish`)
  await outputDir.fill('artifacts/demo app')
  await expect(dialog.getByTestId('dotnet-publish-command')).toHaveText(
    'dotnet publish Demo/Demo.csproj -c Release -o "artifacts/demo app"'
  )
  await orcaPage.screenshot({ path: testInfo.outputPath('publish-dialog.png') })
  await dialog.getByTestId('dotnet-publish-run').click()
  await expect(dialog).toHaveCount(0)

  const trigger = orcaPage.getByTestId('run-configurations-trigger').first()
  await expect(trigger).toHaveText(/Publish Demo to folder/)
  await expect(orcaPage.getByTestId('run-configurations-session').first()).toHaveAttribute(
    'data-run-status',
    'succeeded',
    { timeout: 240_000 }
  )
  expect(existsSync(path.join(root, 'artifacts', 'demo app', 'Demo.dll'))).toBe(true)

  // Publishing again starts from the saved settings.
  const reopened = await openPublishDialog(orcaPage)
  await expect(reopened.getByTestId('dotnet-publish-output-dir')).toHaveValue('artifacts/demo app')
  await reopened.getByRole('button', { name: 'Cancel' }).click()

  // It is an ordinary configuration in Edit Configurations.
  await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  await trigger.click()
  await orcaPage.getByTestId('run-widget-manage').click()
  await orcaPage.getByTestId('run-configurations-edit').click()
  const editor = orcaPage.getByTestId('edit-run-configurations-dialog')
  await expect(editor.getByTestId('dotnet-publish-output-dir')).toHaveValue('artifacts/demo app')
  await editor.getByTestId('dotnet-publish-runtime').click()
  await orcaPage.getByRole('option', { name: 'linux-x64' }).click()
  await expect(editor.getByTestId('dotnet-publish-command')).toHaveText(
    'dotnet publish Demo/Demo.csproj -c Release -r linux-x64 --self-contained false -o "artifacts/demo app"'
  )
  await orcaPage.screenshot({ path: testInfo.outputPath('edit-configurations.png') })
  await editor.getByRole('button', { name: 'Cancel' }).click()
})
