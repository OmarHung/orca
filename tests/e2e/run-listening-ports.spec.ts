import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { launchCurrentFile } from './helpers/run-panel'
import { waitForSessionReady } from './helpers/store'

const SERVER_LABEL = 'E2E port server'

type OpenedUrlProbe = { urls: string[] }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** Records system-browser opens in main instead of launching the user's browser. */
async function recordExternalOpens(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell }) => {
    const probe: OpenedUrlProbe = { urls: [] }
    Object.assign(globalThis, { __runPortOpenedUrls: probe })
    shell.openExternal = async (url: string) => {
      probe.urls.push(url)
    }
  })
}

/** The browser tab the tab strip shows for the workspace, by its browser tab id. */
async function workspaceBrowserTabId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    return (
      (state?.unifiedTabsByWorktree[state.activeWorktreeId ?? ''] ?? []).find(
        (tab) => tab.contentType === 'browser'
      )?.entityId ?? null
    )
  })
}

async function externalOpens(electronApp: ElectronApplication): Promise<string[]> {
  return electronApp.evaluate(() => {
    const probe: unknown = Reflect.get(globalThis, '__runPortOpenedUrls')
    return probe && typeof probe === 'object' && 'urls' in probe && Array.isArray(probe.urls)
      ? probe.urls.map(String)
      : []
  })
}

test('a run shows the port it listens on and opens it in the system or Orca browser', async ({
  electronApp,
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-ports')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const port = await freePort()

  await waitForSessionReady(orcaPage)
  await recordExternalOpens(electronApp)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async ({ label, command }) => {
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: [
          {
            id: 'e2e-run-ports',
            label,
            scope: { type: 'global' as const },
            action: 'terminal-command' as const,
            command,
            appendEnter: true
          }
        ]
      })
    },
    {
      label: SERVER_LABEL,
      command: `node -e "require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1')"`
    }
  )

  await orcaPage.getByTestId('run-configurations-trigger').click()
  await orcaPage.getByRole('menuitem', { name: SERVER_LABEL }).click()
  await orcaPage.getByRole('button', { name: `Run quick command: ${SERVER_LABEL}` }).click()

  // The port shows beside the Run widget's controls and in the Run panel's header.
  const widgetLink = orcaPage
    .getByTestId('run-configurations-widget')
    .locator(`[data-testid="run-port-link"][data-port="${port}"]`)
  await expect(widgetLink).toBeVisible({ timeout: 30_000 })
  await expect(widgetLink).toHaveText(`:${port}`)
  const panelLink = orcaPage
    .getByTestId('bottom-panel')
    .locator(`[data-testid="run-port-link"][data-port="${port}"]`)
  await expect(panelLink).toBeVisible()
  await expect(panelLink).toContainText(String(port))
  await orcaPage.screenshot({ path: testInfo.outputPath('run-listening-ports.png') })

  // A plain click opens the system browser.
  await widgetLink.click()
  await expect.poll(() => externalOpens(electronApp)).toEqual([expect.stringContaining(`:${port}`)])

  // ⌘/Ctrl+click opens Orca's own browser in this workspace instead.
  await panelLink.click({ modifiers: ['ControlOrMeta'] })
  await expect.poll(() => workspaceBrowserTabId(orcaPage), { timeout: 15_000 }).not.toBeNull()
  const browserTabId = await workspaceBrowserTabId(orcaPage)
  await expect(orcaPage.locator(`[data-tab-id="${browserTabId}"]`)).toHaveAttribute(
    'data-active',
    'true'
  )
  expect(await externalOpens(electronApp)).toHaveLength(1)
})

test('a debug session shows the port its program listens on, not its inspector', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-ports')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const port = await freePort()
  writeFileSync(
    path.join(fixture.worktreePath, 'server.js'),
    `require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1')\n`
  )

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
      has: orcaPage.locator('[data-file-explorer-row-name]').getByText('server.js', { exact: true })
    })
    .click()
  await expect(orcaPage.locator('.monaco-editor').first()).toContainText('createServer', {
    timeout: 25_000
  })

  await launchCurrentFile(orcaPage, 'debug')
  // Why the long timeout: the first debug run downloads and extracts js-debug.
  const panelLink = orcaPage
    .getByTestId('bottom-panel')
    .locator(`[data-testid="run-port-link"][data-port="${port}"]`)
  await expect(panelLink).toBeVisible({ timeout: 120_000 })
  // The inspector js-debug opens in the same process is not offered as a page to open.
  await expect(orcaPage.getByTestId('bottom-panel').getByTestId('run-port-link')).toHaveCount(1)
  await expect(
    orcaPage
      .getByTestId('run-configurations-widget')
      .locator(`[data-testid="run-port-link"][data-port="${port}"]`)
  ).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('debug-listening-ports.png') })
})

test('runs sharing a workspace each show only their own port', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-ports-shared')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const servers = [
    { label: 'E2E api server', port: await freePort() },
    { label: 'E2E web server', port: await freePort() }
  ]

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async (entries) => {
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: entries.map(({ label, command }, index) => ({
          id: `e2e-run-ports-shared-${index}`,
          label,
          scope: { type: 'global' as const },
          action: 'terminal-command' as const,
          command,
          appendEnter: true
        }))
      })
    },
    servers.map(({ label, port }) => ({
      label,
      // Why the delay: both runs start before either binds, so start times cannot tell them apart.
      command: `sleep 4; node -e "require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1')"`
    }))
  )

  for (const { label } of servers) {
    await expect(orcaPage.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0)
    await orcaPage.getByTestId('run-configurations-trigger').click()
    await orcaPage.getByRole('menuitem', { name: label }).click()
    await orcaPage.getByRole('button', { name: `Run quick command: ${label}` }).click()
  }

  // The widget shows the selected run (the web server) and nothing of the api server.
  const widgetLinks = orcaPage.getByTestId('run-configurations-widget').getByTestId('run-port-link')
  await expect(widgetLinks).toHaveCount(1, { timeout: 30_000 })
  await expect(widgetLinks).toHaveAttribute('data-port', String(servers[1].port))

  // Each Run panel tab shows only its own run's port.
  const panelLinks = orcaPage.getByTestId('bottom-panel').getByTestId('run-port-link')
  for (const { label, port } of servers) {
    await orcaPage.getByTestId('run-panel-tab').filter({ hasText: label }).click()
    await expect(panelLinks).toHaveCount(1, { timeout: 30_000 })
    await expect(panelLinks).toHaveAttribute('data-port', String(port))
  }
})
