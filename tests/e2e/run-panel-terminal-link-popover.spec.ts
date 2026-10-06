import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { getRunPanelTerminalContent } from './helpers/run-panel'
import { waitForSessionReady } from './helpers/store'

const SERVER_LABEL = 'E2E link server'
const LINK = 'http://localhost:7800/'
// Why arithmetic: the output must not match the echoed command line itself.
const SERVER_COMMAND = 'echo "listening on http://localhost:$((7700+100))/"; sleep 300'

type OpenedUrlProbe = { urls: string[] }

async function recordExternalOpens(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell }) => {
    const probe: OpenedUrlProbe = { urls: [] }
    Object.assign(globalThis, { __runLinkOpenedUrls: probe })
    shell.openExternal = async (url: string) => {
      probe.urls.push(url)
    }
  })
}

async function externalOpens(electronApp: ElectronApplication): Promise<string[]> {
  return electronApp.evaluate(() => {
    const probe: unknown = Reflect.get(globalThis, '__runLinkOpenedUrls')
    return probe && typeof probe === 'object' && 'urls' in probe && Array.isArray(probe.urls)
      ? probe.urls.map(String)
      : []
  })
}

/** Viewport point at the middle of the link the Run panel's terminal renders. */
async function runPanelLinkPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate((linkText) => {
    const tabId = document
      .querySelector('[data-testid="run-panel-terminal"]')
      ?.getAttribute('data-run-tab-id')
    const manager = tabId ? window.__paneManagers?.get(tabId) : undefined
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
    if (!pane || !screen) {
      throw new Error('Run panel terminal screen unavailable')
    }
    const buffer = pane.terminal.buffer.active
    for (let row = 0; row < pane.terminal.rows; row += 1) {
      const text = buffer.getLine(buffer.viewportY + row)?.translateToString(false)
      const column = text?.indexOf(linkText) ?? -1
      if (column < 0 || text?.includes('echo')) {
        continue
      }
      const rect = screen.getBoundingClientRect()
      const cell = pane.terminal.dimensions?.css.cell
      if (!cell?.width || !cell.height) {
        throw new Error('Run panel terminal cell dimensions unavailable')
      }
      return {
        x: rect.left + (column + linkText.length / 2) * cell.width,
        y: rect.top + (row + 0.5) * cell.height
      }
    }
    throw new Error('Rendered run link unavailable')
  }, LINK)
}

async function workspaceBrowserTabCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    return (state?.unifiedTabsByWorktree[state.activeWorktreeId ?? ''] ?? []).filter(
      (tab) => tab.contentType === 'browser'
    ).length
  })
}

async function startRunWithLink(page: Page): Promise<void> {
  await page.evaluate(
    async ({ label, command }) => {
      await window.__store?.getState().updateSettings({
        terminalLinkActionPopoverEnabled: true,
        terminalQuickCommands: [
          {
            id: 'e2e-run-link',
            label,
            scope: { type: 'global' as const },
            action: 'terminal-command' as const,
            command,
            appendEnter: true
          }
        ]
      })
    },
    { label: SERVER_LABEL, command: SERVER_COMMAND }
  )
  await page.getByTestId('run-configurations-trigger').click()
  await page.getByRole('menuitem', { name: SERVER_LABEL }).click()
  await page.getByRole('button', { name: `Run quick command: ${SERVER_LABEL}` }).click()
  await expect
    .poll(() => getRunPanelTerminalContent(page), { timeout: 30_000 })
    .toContain(`listening on ${LINK}`)
}

test('a link popover row in the Run panel opens the link', async ({
  electronApp,
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-link-popover')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))

  await waitForSessionReady(orcaPage)
  await recordExternalOpens(electronApp)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await startRunWithLink(orcaPage)

  const popover = orcaPage.locator('[data-terminal-link-action-popover]')
  const openPopover = async (): Promise<void> => {
    const point = await runPanelLinkPoint(orcaPage)
    await orcaPage.mouse.move(point.x, point.y)
    await orcaPage.mouse.click(point.x, point.y)
    await expect(popover).toBeVisible()
    await expect(orcaPage.locator('[data-terminal-link-destination]')).toHaveText(LINK)
  }

  // Pressing a row must not cost the Run panel's terminal its focus, or the popover closes first.
  await openPopover()
  await orcaPage.screenshot({ path: testInfo.outputPath('run-link-popover-open.png') })
  await popover.getByRole('button', { name: /System Browser/ }).click()
  await expect.poll(() => externalOpens(electronApp)).toEqual([LINK])
  await expect(popover).toHaveCount(0)

  await openPopover()
  await popover.getByRole('button', { name: /Orca Browser/ }).click()
  await expect.poll(() => workspaceBrowserTabCount(orcaPage), { timeout: 15_000 }).toBe(1)
  expect(await externalOpens(electronApp)).toEqual([LINK])
})
