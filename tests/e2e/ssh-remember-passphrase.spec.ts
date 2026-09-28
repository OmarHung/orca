/**
 * Remembering an SSH key passphrase: the prompt asks once, the next connect unlocks the key by
 * itself, and forgetting it in SSH settings brings the prompt back.
 *
 * Requires: ORCA_E2E_SSH_DOCKER=1 and Docker available.
 */
import { execFileSync } from 'node:child_process'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const PASSPHRASE = 'e2e-key-passphrase'

async function addTarget(page: Page, target: DockerSshRelayTarget): Promise<string> {
  return page.evaluate(async ({ host, port, identityFile }) => {
    const { target: created } = await window.api.ssh.addTarget({
      target: {
        label: 'Passphrase E2E',
        host,
        port,
        username: 'root',
        identityFile,
        identitiesOnly: true,
        relayGracePeriodSeconds: 1
      }
    })
    const store = window.__store!
    const labels = new Map(store.getState().sshTargetLabels)
    labels.set(created.id, created.label)
    store.getState().setSshTargetLabels(labels)
    return created.id
  }, target)
}

/** Starts a connect without waiting, since it blocks on the passphrase prompt. */
async function startConnect(page: Page, targetId: string): Promise<void> {
  await page.evaluate((id) => {
    const connecting = window.api.ssh.connect({ targetId: id }).then((state) => state?.status)
    Reflect.set(window, '__e2eSshConnect', connecting)
  }, targetId)
}

async function connectResult(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, '__e2eSshConnect'))
}

async function disconnect(page: Page, targetId: string): Promise<void> {
  await page.evaluate((id) => window.api.ssh.disconnect({ targetId: id }), targetId)
}

async function countCredentialPrompts(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.set(window, '__e2eCredentialPrompts', 0)
    window.api.ssh.onCredentialRequest(() => {
      Reflect.set(
        window,
        '__e2eCredentialPrompts',
        Reflect.get(window, '__e2eCredentialPrompts') + 1
      )
    })
  })
}

async function credentialPrompts(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, '__e2eCredentialPrompts'))
}

test.describe('Remembered SSH key passphrases', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH tests.')

  test('asks once, unlocks the key by itself afterwards, and asks again once forgotten', async ({
    orcaPage,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    test.setTimeout(300_000)
    const target = startDockerSshRelayTarget(testInfo)
    registerPostElectronShutdownCleanup(async () => cleanupDockerSshRelayTarget(target))
    execFileSync('ssh-keygen', ['-p', '-q', '-P', '', '-N', PASSPHRASE, '-f', target.identityFile])

    await waitForSessionReady(orcaPage)
    await countCredentialPrompts(orcaPage)
    const targetId = await addTarget(orcaPage, target)

    await startConnect(orcaPage, targetId)
    const dialog = orcaPage.getByRole('dialog', { name: 'SSH Key Passphrase' })
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    const input = dialog.getByPlaceholder('Enter passphrase')

    await input.fill('not the passphrase')
    await dialog.getByRole('button', { name: 'Unlock' }).click()
    await expect(dialog.getByRole('alert')).toHaveText("That passphrase doesn't unlock this key.")
    await expect(input).toHaveAttribute('aria-invalid', 'true')

    await input.fill(PASSPHRASE)
    await dialog.getByRole('checkbox', { name: 'Remember passphrase' }).check()
    await orcaPage.screenshot({ path: testInfo.outputPath('remember-passphrase-dialog.png') })
    await dialog.getByRole('button', { name: 'Unlock' }).click()
    await expect(dialog).toBeHidden()
    expect(await connectResult(orcaPage)).toBe('connected')

    await disconnect(orcaPage, targetId)
    await startConnect(orcaPage, targetId)
    expect(await connectResult(orcaPage)).toBe('connected')
    expect(await credentialPrompts(orcaPage)).toBe(1)
    expect(
      await orcaPage.evaluate(
        (id) => window.api.ssh.needsPassphrasePrompt({ targetId: id }),
        targetId
      )
    ).toBe(false)

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'ssh', repoId: null, sectionId: 'ssh' })
      state.openSettingsPage()
    })
    const saved = orcaPage.getByText(target.identityFile, { exact: true })
    await expect(saved).toBeVisible({ timeout: 30_000 })
    await saved.scrollIntoViewIfNeeded()
    await orcaPage.screenshot({ path: testInfo.outputPath('saved-passphrases-settings.png') })
    await saved.locator('xpath=..').getByRole('button', { name: 'Forget' }).click()
    await expect(saved).toBeHidden()

    await disconnect(orcaPage, targetId)
    await startConnect(orcaPage, targetId)
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await credentialPrompts(orcaPage)).toBe(2)
  })
})
