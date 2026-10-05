import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  getTerminalContent,
  sendToTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

// 64x64 solid PNG; the preview must decode it, not just render a placeholder.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYUlEQVR4nO3PIREAIBAAMFqhMWgyUYMun4QQaBQZEO92twIrZ/RUde1URUBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgO9BiprrRUgkICAgICAgICAgICAgICAgICAgICAgIfHuebLmH1pKnMwAAAABJRU5ErkJggg=='
// Claude Code 2.1.289's real screen after two image pastes: alternate screen, mouse
// tracking on, and `[Image #1] [Image #2]` in the prompt.
const CLAUDE_SCREEN_FIXTURE = path.resolve(
  __dirname,
  '../../src/main/runtime/__fixtures__/claude-image-paste-markers.txt'
)
const SCAN_CHAR_LIMIT = 12_000
const isMac = process.platform === 'darwin'

type Descriptor = { paneKey: string; worktreeId: string }
type ChipPoint = { x: number; y: number }

async function preparePane(page: Page): Promise<{ ptyId: string; descriptor: Descriptor }> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  const ptyId = await waitForActivePanePtyId(page)
  await waitForPtyShellEcho(page, ptyId, 15_000)
  return { ptyId, descriptor: await waitForActivePaneHookDescriptor(page) }
}

/** Reports the pane as Claude Code, as its hooks would. */
async function markPaneAsClaude(
  page: Page,
  { paneKey, worktreeId }: Descriptor,
  transcriptPath: string
): Promise<void> {
  await page.evaluate(
    ({ paneKey, worktreeId, transcriptPath }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      store
        .getState()
        .setAgentStatus(
          paneKey,
          { state: 'done', agentType: 'claude', prompt: '' },
          'Claude',
          undefined,
          { worktreeId }
        )
      const entry = store.getState().agentStatusByPaneKey[paneKey]
      if (!entry) {
        throw new Error('Agent status was not recorded')
      }
      store.setState({
        agentStatusByPaneKey: {
          ...store.getState().agentStatusByPaneKey,
          [paneKey]: {
            ...entry,
            providerSession: { key: 'session_id', id: 'e2e-claude-session', transcriptPath }
          }
        }
      })
    },
    { paneKey, worktreeId, transcriptPath }
  )
}

/** Repaints the captured Claude screen and holds it, swallowing mouse reports like Claude. */
async function replayClaudeScreen(page: Page, ptyId: string, scriptPath: string): Promise<void> {
  await writeFile(
    scriptPath,
    `
const { readFileSync } = require('node:fs')
process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  if (chunk.includes(3)) {
    process.stdout.write('\\x1b[?1000l\\x1b[?1002l\\x1b[?1003l\\x1b[?1006l\\x1b[?1049l')
    process.exit(0)
  }
})
process.stdout.write(readFileSync(${JSON.stringify(CLAUDE_SCREEN_FIXTURE)}))
`
  )
  await sendToTerminal(page, ptyId, `${nodeTerminalCommand([scriptPath])}\r`)
}

/** Hovers `[Image #N]` until xterm's linkifier owns it, as a user's pointer would. */
async function hoverChip(page: Page, chip: string): Promise<ChipPoint> {
  let point: ChipPoint | null = null
  await expect
    .poll(
      async () => {
        point = await page.evaluate((chip) => {
          const state = window.__store?.getState()
          const worktreeId = state?.activeWorktreeId
          const tabId =
            state?.activeTabType === 'terminal'
              ? state.activeTabId
              : worktreeId
                ? state?.activeTabIdByWorktree?.[worktreeId]
                : null
          const manager = tabId ? window.__paneManagers?.get(tabId) : null
          const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
          const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen')
          if (!pane || !screen) {
            return null
          }
          const buffer = pane.terminal.buffer.active
          for (let row = pane.terminal.rows - 1; row >= 0; row -= 1) {
            const col = (
              buffer.getLine(buffer.viewportY + row)?.translateToString(false) ?? ''
            ).lastIndexOf(chip)
            if (col !== -1) {
              const rect = screen.getBoundingClientRect()
              return {
                x: rect.left + (col + chip.length / 2) * (rect.width / pane.terminal.cols),
                y: rect.top + (row + 0.5) * (rect.height / pane.terminal.rows)
              }
            }
          }
          return null
        }, chip)
        if (!point) {
          return null
        }
        await page.mouse.move(point.x, point.y)
        return page.evaluate(() => {
          const state = window.__store?.getState()
          const worktreeId = state?.activeWorktreeId
          const tabId =
            state?.activeTabType === 'terminal'
              ? state.activeTabId
              : worktreeId
                ? state?.activeTabIdByWorktree?.[worktreeId]
                : null
          const manager = tabId ? window.__paneManagers?.get(tabId) : null
          const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
          // The pane's link tooltip is what the user sees once xterm owns the hover.
          const tooltip = pane?.linkTooltip
          return tooltip && tooltip.style.display !== 'none' ? tooltip.textContent : null
        })
      },
      { timeout: 15_000, message: `${chip} never became a hovered link` }
    )
    .toBe(`${chip} (Click for actions or ${isMac ? '⌘' : 'Ctrl'}+click to preview)`)
  if (!point) {
    throw new Error(`${chip} is not on screen`)
  }
  return point
}

/** Substitutes clipboard reads in main only; the user's system clipboard is never touched. */
async function stubClipboardImage(
  electronApp: ElectronApplication,
  imagePath: string
): Promise<void> {
  await electronApp.evaluate(
    ({ ipcMain }, { imagePath }) => {
      ipcMain.removeHandler('clipboard:readText')
      ipcMain.handle('clipboard:readText', () => '')
      ipcMain.removeHandler('clipboard:saveImageAsTempFile')
      ipcMain.handle('clipboard:saveImageAsTempFile', () => imagePath)
    },
    { imagePath }
  )
}

async function expectDecodedImage(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '[Image #1]' })
  await expect(dialog).toBeVisible()
  const image = dialog.getByRole('img', { name, exact: true })
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(64)
}

test.describe('Claude [Image #N] chip preview', () => {
  test('previews a submitted chip from the Claude transcript via the link actions', async ({
    orcaPage
  }, testInfo) => {
    const { ptyId, descriptor } = await preparePane(orcaPage)
    const transcriptPath = testInfo.outputPath('claude-session.jsonl')
    // Claude Code 2.1.289 records `imagePasteIds` next to one base64 block per chip.
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: 'user',
        timestamp: new Date().toISOString(),
        imagePasteIds: [1],
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '[Image #1] what is this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }
          ]
        }
      })}\n`
    )
    await markPaneAsClaude(orcaPage, descriptor, transcriptPath)
    try {
      await replayClaudeScreen(orcaPage, ptyId, testInfo.outputPath('replay-claude.cjs'))

      const point = await hoverChip(orcaPage, '[Image #1]')
      await orcaPage.mouse.click(point.x, point.y)
      const actionPopover = orcaPage.locator('[data-terminal-link-action-popover]')
      await expect(actionPopover).toBeVisible()
      await actionPopover.getByRole('button', { name: 'Preview image' }).click()

      await expectDecodedImage(orcaPage, '[Image #1]')
      await orcaPage.screenshot({ path: testInfo.outputPath('submitted-chip-preview.png') })
    } finally {
      await sendToTerminal(orcaPage, ptyId, '\x03').catch(() => undefined)
    }
  })

  test('matches an unsent chip to the image pasted into the terminal on Cmd/Ctrl+click', async ({
    orcaPage,
    electronApp,
    testRepoPath
  }, testInfo) => {
    const { ptyId, descriptor } = await preparePane(orcaPage)
    // Inside the worktree: the stub skips the temp-file read grant the real save makes.
    const imagePath = path.join(testRepoPath, 'unsent-chip.png')
    await writeFile(imagePath, Buffer.from(PNG, 'base64'))
    // No transcript yet: Claude writes it on the first submit.
    await markPaneAsClaude(orcaPage, descriptor, testInfo.outputPath('not-written-yet.jsonl'))
    await stubClipboardImage(electronApp, imagePath)

    await orcaPage.locator('.xterm-helper-textarea').first().focus()
    await orcaPage.keyboard.press(isMac ? 'Meta+V' : 'Control+V')
    await expect
      .poll(() => getTerminalContent(orcaPage, SCAN_CHAR_LIMIT), { timeout: 15_000 })
      .toContain('unsent-chip.png')
    // The shell received the pasted path; drop it before Claude's screen takes over.
    await sendToTerminal(orcaPage, ptyId, '\x03')
    try {
      await replayClaudeScreen(orcaPage, ptyId, testInfo.outputPath('replay-claude.cjs'))

      const point = await hoverChip(orcaPage, '[Image #1]')
      await orcaPage.keyboard.down(isMac ? 'Meta' : 'Control')
      await orcaPage.mouse.click(point.x, point.y)
      await orcaPage.keyboard.up(isMac ? 'Meta' : 'Control')

      await expectDecodedImage(orcaPage, 'unsent-chip.png')
      await expect(
        orcaPage.getByText('Not sent yet — matched by paste order.', { exact: false })
      ).toBeVisible()
      await orcaPage.screenshot({ path: testInfo.outputPath('unsent-chip-preview.png') })
    } finally {
      await sendToTerminal(orcaPage, ptyId, '\x03').catch(() => undefined)
    }
  })
})
