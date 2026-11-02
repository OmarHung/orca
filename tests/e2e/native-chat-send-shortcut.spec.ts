// With the default send shortcut, only Cmd/Ctrl+Enter sends; Enter adds a line or picks from a menu.

import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { SUPPORTED, createChatOnHost, test } from './helpers/structured-claude-stub'

const SEND = 'ControlOrMeta+Enter'
const SKILL = 'e2e-review'

/** Reports a skill from the stub, which otherwise reports none, so the / menu has one to pick. */
function stubReportingSkill(claudeCommand: string): string {
  const wrapper = path.join(path.dirname(claudeCommand), 'claude-with-skill')
  writeFileSync(wrapper, `#!/bin/sh\nORCA_E2E_STUB_SKILLS=${SKILL} exec '${claudeCommand}' "$@"\n`)
  chmodSync(wrapper, 0o755)
  return wrapper
}

async function openChat(page: Page, claudeCommand: string) {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await page.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      experimentalNativeChat: true,
      defaultTuiAgent: 'claude',
      agentCmdOverrides: { claude: command }
    })
  }, buildFakeAgentCommandOverride(claudeCommand))
  const sessionId = await createChatOnHost(page, worktreeId)
  const readTabId = () =>
    page.evaluate(
      ({ worktreeId, sessionId }) =>
        window.__store
          ?.getState()
          .unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.entityId === sessionId)?.id,
      { worktreeId, sessionId }
    )
  await expect.poll(readTabId, { timeout: 30_000 }).toBeTruthy()
  await page.locator(`[data-testid="sortable-tab"][data-tab-id="${await readTabId()}"]`).click()
  const chat = page.locator('[data-native-chat-root="true"]')
  const composer = chat.getByRole('textbox')
  await composer.click()
  return {
    chat,
    composer,
    menu: page.locator('[role="listbox"][id^="native-chat-picker-"]'),
    stop: chat.getByRole('button', { name: 'Stop the agent' }),
    reply: chat.getByText('Stub reply.')
  }
}

test.describe('native chat send shortcut', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('Enter adds a line and only the shortcut sends', async ({ orcaPage: page, claudeStub }) => {
    const { chat, composer, reply } = await openChat(page, claudeStub.command)
    await page.keyboard.type('line one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line two')
    await expect(composer.locator('p')).toHaveCount(2)
    await expect(composer).toContainText('line one')
    await expect(composer).toContainText('line two')
    await expect(reply).toHaveCount(0)

    await page.keyboard.press(SEND)
    await expect(reply).toBeVisible({ timeout: 30_000 })
    await expect(composer).toHaveText('')
    await expect(chat.getByText('line two')).toBeVisible()
  })

  test('the skill menu picks on Enter and sends on the shortcut', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { chat, composer, menu, stop, reply } = await openChat(
      page,
      stubReportingSkill(claudeStub.command)
    )
    const option = menu.getByRole('option', { name: new RegExp(SKILL) })

    // The stub reports its skill once the first turn has launched it.
    await page.keyboard.type('hello')
    await page.keyboard.press(SEND)
    await expect(reply).toHaveCount(1, { timeout: 30_000 })
    await expect(stop).toHaveCount(0, { timeout: 30_000 })

    await page.keyboard.type('/e2e')
    await expect(option).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect(composer.locator('[data-native-chat-skill]')).toHaveCount(1)
    await expect(reply).toHaveCount(1)

    await page.keyboard.press(SEND)
    await expect(reply).toHaveCount(2, { timeout: 30_000 })
    await expect(stop).toHaveCount(0, { timeout: 30_000 })
    await expect(composer).toHaveText('')

    await page.keyboard.type('/e2e')
    await expect(option).toBeVisible()
    await page.keyboard.press(SEND)
    await expect(reply).toHaveCount(3, { timeout: 30_000 })
    await expect(composer).toHaveText('')
    await expect(chat.getByText(`/${SKILL}`)).toHaveCount(2)
  })

  test('the file menu picks on Enter and sends on the shortcut', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { chat, composer, menu, reply } = await openChat(page, claudeStub.command)
    const option = menu.getByRole('option', { name: /index\.ts/ })

    await page.keyboard.type('review @index')
    await expect(option).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Enter')
    await expect(composer).toHaveText('review @src/index.ts ')
    await expect(reply).toHaveCount(0)

    await page.keyboard.type('and @index')
    await expect(option).toBeVisible()
    await page.keyboard.press(SEND)
    await expect(reply).toBeVisible({ timeout: 30_000 })
    await expect(composer).toHaveText('')
    await expect(chat.getByText('review @src/index.ts and @src/index.ts')).toBeVisible()
  })

  test('turned off, Enter sends and Shift+Enter adds a line', async ({
    orcaPage: page,
    claudeStub
  }) => {
    const { composer, reply } = await openChat(page, claudeStub.command)
    await page.evaluate(() =>
      window.__store?.getState().updateSettings({ nativeChatSendWithShortcutOnly: false })
    )
    await page.keyboard.type('line one')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('line two')
    await expect(reply).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(reply).toBeVisible({ timeout: 30_000 })
    await expect(composer).toHaveText('')
  })
})
