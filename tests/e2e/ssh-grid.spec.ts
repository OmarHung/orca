import { writeFileSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const SSH_WORKTREE_ID = 'global-ssh-sessions'
const MULTI_SELECT_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control'
const PANE_COUNT = 9

// Why port 9: nothing listens on it, so each ssh fails fast and leaves a local shell to type into.
function targetLabel(index: number): string {
  return `e2e-grid-host-${index}`
}

async function addTargets(page: Page, count: number): Promise<void> {
  await page.evaluate(
    async (labels) => {
      for (const label of labels) {
        await window.api.ssh.addTarget({
          target: { label, host: '127.0.0.1', port: 9, username: 'nobody' }
        })
      }
    },
    Array.from({ length: count }, (_, index) => targetLabel(index))
  )
}

function hostRow(page: Page, index: number): ReturnType<Page['locator']> {
  return page
    .locator('[data-ssh-page] [data-ssh-host-row]')
    .filter({ hasText: new RegExp(`^${targetLabel(index)}(?!\\d)`) })
}

type TabSummary = { id: string; label: string | null; ptyId: string | null }

async function readTabs(page: Page): Promise<TabSummary[]> {
  return page.evaluate(
    (worktreeId) =>
      (window.__store?.getState().tabsByWorktree[worktreeId] ?? []).map((tab) => ({
        id: tab.id,
        label: tab.quickCommandLabel ?? null,
        ptyId: tab.ptyId
      })),
    SSH_WORKTREE_ID
  )
}

async function readTerminalText(page: Page, tabId: string): Promise<string> {
  return page.evaluate(
    (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.serializeAddon?.serialize?.() ?? '',
    tabId
  )
}

function cell(page: Page, tabId: string): ReturnType<Page['locator']> {
  return page.locator(`[data-remote-terminal-cell="${tabId}"]`)
}

/** Remembers each tab's mounted terminal, so a later check proves it was never replaced. */
async function rememberMountedTerminals(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = new Map(window.__paneManagers)
    Reflect.set(window, '__gridProbe', probe)
  })
}

async function replacedTerminals(page: Page, tabIds: readonly string[]): Promise<string[]> {
  return page.evaluate((ids) => {
    const probe: unknown = Reflect.get(window, '__gridProbe')
    return ids.filter(
      (id) => !(probe instanceof Map) || probe.get(id) !== window.__paneManagers?.get(id)
    )
  }, tabIds)
}

async function typeIn(page: Page, tabId: string, text: string): Promise<void> {
  await cell(page, tabId).locator('.xterm').click()
  await expect(cell(page, tabId).locator('textarea')).toBeFocused()
  await page.keyboard.type(text)
}

test('shows nine terminals together, each taking its own input, and never restarts one', async ({
  orcaPage
}, testInfo) => {
  // Starts nine login shells and types into each, one after another.
  test.setTimeout(240_000)
  const consoleLines: string[] = []
  orcaPage.on('console', (message) => consoleLines.push(message.text()))
  await waitForSessionReady(orcaPage)
  await addTargets(orcaPage, PANE_COUNT + 1)
  await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
  const sshPage = orcaPage.locator('[data-ssh-page]')
  await expect(hostRow(orcaPage, 0)).toBeVisible()

  // Picking hosts opens nothing yet.
  for (let index = 0; index < PANE_COUNT; index += 1) {
    await hostRow(orcaPage, index).click({ modifiers: [MULTI_SELECT_MODIFIER] })
  }
  expect(await readTabs(orcaPage)).toEqual([])
  await expect(sshPage.locator('[data-ssh-host-selection]')).toContainText(`${PANE_COUNT}`)
  await sshPage.locator('[data-ssh-host-selection-open]').click()

  // One dialog shows every ssh command, and nothing runs before it is confirmed.
  const dialog = orcaPage.locator('[data-command-confirm]')
  await expect(dialog.locator('[data-command-list] li')).toHaveCount(PANE_COUNT)
  expect(await readTabs(orcaPage)).toEqual([])
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-grid-confirm.png') })
  await dialog.getByRole('button', { name: 'Connect' }).click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => (await readTabs(orcaPage)).length).toBe(PANE_COUNT)
  await expect
    .poll(async () => (await readTabs(orcaPage)).filter((tab) => tab.ptyId).length, {
      timeout: 60_000
    })
    .toBe(PANE_COUNT)
  const tabs = await readTabs(orcaPage)
  const tabIds = tabs.map((tab) => tab.id)
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT)
  for (const tabId of tabIds) {
    await expect
      .poll(() => readTerminalText(orcaPage, tabId), { timeout: 60_000 })
      .toContain('Connection refused')
  }

  // Each pane has one way to leave the grid, not also the terminal's own close and split.
  await expect(cell(orcaPage, tabIds[0]).locator('.pane-title-actions')).toBeHidden()

  // Three rows of three, with no pane on top of another.
  const boxes = await Promise.all(tabIds.map((tabId) => cell(orcaPage, tabId).boundingBox()))
  expect(new Set(boxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(3)
  expect(new Set(boxes.map((box) => Math.round(box?.x ?? -1))).size).toBe(3)
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-grid-nine.png') })
  await rememberMountedTerminals(orcaPage)

  // Each pane takes its own keystrokes, and no other pane sees them.
  for (const [index, tabId] of tabIds.entries()) {
    await typeIn(orcaPage, tabId, `echo pane-${index}-$((40+2))\n`)
    await expect.poll(() => readTerminalText(orcaPage, tabId)).toContain(`pane-${index}-42`)
  }
  for (const [index, tabId] of tabIds.entries()) {
    const text = await readTerminalText(orcaPage, tabId)
    const others = tabIds.map((_, other) => other).filter((other) => other !== index)
    expect(others.filter((other) => text.includes(`pane-${other}-`))).toEqual([])
  }

  // How many panes draw with WebGL at nine, and whether any lost its context doing so.
  const renderers = await orcaPage.evaluate(
    (ids) =>
      ids.map((id) => {
        const pane = window.__paneManagers?.get(id)?.getPanes?.()[0]
        return Reflect.get(pane ?? {}, 'webglAddon') != null
      }),
    tabIds
  )
  writeFileSync(
    testInfo.outputPath('webgl-report.json'),
    JSON.stringify({
      webglPanes: renderers.filter(Boolean).length,
      contextLost: consoleLines.filter((line) => line.includes('WebGL context lost')).length
    })
  )
  expect(consoleLines.filter((line) => line.includes('WebGL context lost'))).toEqual([])

  // Removing another pane leaves the user where they are.
  await expect(cell(orcaPage, tabIds[8])).toHaveAttribute('data-active', 'true')
  await cell(orcaPage, tabIds[8]).locator('.xterm').click()
  await cell(orcaPage, tabIds[0]).locator('[data-remote-grid-action="remove"]').click()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT - 1)
  await expect(cell(orcaPage, tabIds[8])).toHaveAttribute('data-active', 'true')
  await hostRow(orcaPage, 0).click()
  await sshPage.locator('[data-remote-grid-hint-add]').click()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT)
  await cell(orcaPage, tabIds[8]).locator('.xterm').click()

  // Removing a pane only stops showing it: the tab, its PTY and its terminal all stay.
  // It is the pane in use, so the grid moves on to the next one: the first, added back last above.
  const removed = tabIds[8]
  await expect(cell(orcaPage, removed)).toHaveAttribute('data-active', 'true')
  await cell(orcaPage, removed).locator('[data-remote-grid-action="remove"]').click()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT - 1)
  await expect(cell(orcaPage, tabIds[0])).toHaveAttribute('data-active', 'true')
  expect((await readTabs(orcaPage)).map((tab) => tab.id)).toEqual(tabIds)
  expect((await readTabs(orcaPage)).map((tab) => tab.ptyId)).toEqual(tabs.map((tab) => tab.ptyId))

  // A tab outside the grid shows alone, and the grid waits.
  await hostRow(orcaPage, 8).click()
  const hint = sshPage.locator('[data-remote-grid-hint]')
  await expect(hint).toBeVisible()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(0)
  await expect(cell(orcaPage, removed)).toBeVisible()
  await expect(cell(orcaPage, tabIds[0])).toBeHidden()
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-grid-outside.png') })

  await sshPage.locator('[data-remote-grid-hint-return]').click()
  await expect(hint).toBeHidden()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT - 1)
  await expect(cell(orcaPage, removed)).toBeHidden()

  // Adding the open tab back needs no new connection.
  await hostRow(orcaPage, 8).click()
  await sshPage.locator('[data-remote-grid-hint-add]').click()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT)
  await expect(dialog).toBeHidden()

  // The grid shares one layout, and the files below belong to the pane in use.
  await orcaPage.locator('[data-remote-layout="split"]').click()
  await expect(sshPage.locator('[data-remote-files]')).toBeVisible()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(PANE_COUNT)
  await orcaPage.locator('[data-remote-layout="terminal"]').click()
  await expect(sshPage.locator('[data-remote-files]')).toBeHidden()

  expect(await replacedTerminals(orcaPage, tabIds)).toEqual([])
  expect((await readTabs(orcaPage)).map((tab) => tab.ptyId)).toEqual(tabs.map((tab) => tab.ptyId))

  // A tenth host doesn't fit; asking for it says so rather than dropping it silently.
  await hostRow(orcaPage, PANE_COUNT).click({ modifiers: [MULTI_SELECT_MODIFIER] })
  await sshPage.locator('[data-ssh-host-selection-open]').click()
  await expect(orcaPage.getByText('A grid holds 9 panes', { exact: false }).first()).toBeVisible()
  await expect(dialog).toBeHidden()
  expect((await readTabs(orcaPage)).length).toBe(PANE_COUNT)

  // Ending the grid leaves every tab and connection running.
  await orcaPage.locator('[data-remote-grid-control="end"]').click()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(0)
  expect((await readTabs(orcaPage)).map((tab) => tab.id)).toEqual(tabIds)
  expect(await replacedTerminals(orcaPage, tabIds)).toEqual([])
})

test('adds to and leaves a grid from the tab strip', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await addTargets(orcaPage, 3)
  await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
  const sshPage = orcaPage.locator('[data-ssh-page]')
  const dialog = orcaPage.locator('[data-command-confirm]')

  await hostRow(orcaPage, 0).click()
  await dialog.getByRole('button', { name: 'Connect' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await readTabs(orcaPage)).length).toBe(1)

  // The strip's button starts a grid beside the tab on screen.
  await orcaPage.locator('[data-remote-grid-control="start"]').click()
  await orcaPage
    .getByRole('dialog')
    .locator('[data-ssh-host-row]')
    .filter({ hasText: new RegExp(`^${targetLabel(1)}(?!\\d)`) })
    .click()
  await expect(dialog.locator('[data-command-list] li')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Connect' }).click()
  await expect(dialog).toBeHidden()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(2)

  // Clicking a pane makes its tab the active one.
  const tabs = await readTabs(orcaPage)
  await expect
    .poll(async () => (await readTabs(orcaPage)).filter((tab) => tab.ptyId).length, {
      timeout: 30_000
    })
    .toBe(2)
  await cell(orcaPage, tabs[0].id).locator('.xterm').click()
  await expect(cell(orcaPage, tabs[0].id)).toHaveAttribute('data-active', 'true')
  await cell(orcaPage, tabs[1].id).locator('.xterm').click()
  await expect(cell(orcaPage, tabs[1].id)).toHaveAttribute('data-active', 'true')
  await expect(cell(orcaPage, tabs[0].id)).not.toHaveAttribute('data-active', 'true')

  // Down to one pane is no longer a grid.
  await cell(orcaPage, tabs[0].id).locator('[data-remote-grid-action="remove"]').click()
  await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(0)
  await expect(orcaPage.locator('[data-remote-grid-control="start"]')).toBeVisible()
  expect((await readTabs(orcaPage)).length).toBe(2)
})
