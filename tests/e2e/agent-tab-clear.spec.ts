import { expect, test } from './helpers/orca-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { getTerminalContent, waitForTerminalOutput } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

const SUBMITTED_CLEAR = '[GOLDEN_STUB_AGENT_SUBMITTED] /clear'

test('agent tab clear button sends /clear only after confirmation', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await configureGoldenStubAgent(orcaPage, { agent: 'claude' })
  await launchGoldenStubAgentFromNewTab(orcaPage, /^Claude(?:\s|$)/i)

  // The seeded shell tab is not an agent tab, so it gets no clear button.
  await expect(
    orcaPage.locator('[data-testid="sortable-tab"][data-active="false"] [data-tab-clear-button]')
  ).toHaveCount(0)
  const clearButton = orcaPage.locator(
    '[data-testid="sortable-tab"][data-active="true"] [data-tab-clear-button]'
  )
  await expect(clearButton).toBeVisible()

  const dialog = orcaPage.getByRole('dialog')
  await clearButton.click()
  await expect(dialog).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await getTerminalContent(orcaPage)).not.toContain(SUBMITTED_CLEAR)

  await clearButton.click()
  await expect(dialog).toBeVisible()
  // Why: the footer is Cancel then Confirm; a positional lookup keeps the spec locale-independent.
  await dialog.getByRole('button').last().click()
  await waitForTerminalOutput(orcaPage, SUBMITTED_CLEAR, 15_000)
})
