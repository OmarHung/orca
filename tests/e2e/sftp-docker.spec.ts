import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const REMOTE_DIR = '/tmp/orca-sftp-e2e'

async function addDockerTarget(page: Page, target: DockerSshRelayTarget): Promise<string> {
  return page.evaluate(
    async ({ host, port, identityFile }) => {
      const result = await window.api.ssh.addTarget({
        target: {
          label: `Docker SFTP E2E ${Date.now()}`,
          host,
          port,
          username: 'root',
          identityFile,
          identitiesOnly: true
        }
      })
      return result.target.id
    },
    { host: target.host, port: target.port, identityFile: target.identityFile }
  )
}

test.describe('SFTP page against a Docker sshd', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')

  test('lists, uploads, downloads and deletes without the relay', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(180_000)
    let target: DockerSshRelayTarget | null = null
    const localRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-sftp-e2e-'))
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(orcaPage)
      const targetId = await addDockerTarget(orcaPage, target)
      const outbox = path.join(localRoot, 'outbox')
      const inbox = path.join(localRoot, 'inbox')
      mkdirSync(path.join(outbox, 'nested'), { recursive: true })
      mkdirSync(inbox)
      writeFileSync(path.join(outbox, 'hello.txt'), 'hello sftp')
      writeFileSync(path.join(outbox, 'nested', 'deep.txt'), 'deep')

      const result = await orcaPage.evaluate(
        async ({ targetId, remoteDir, sources, inbox }) => {
          const sftp = window.api.sftp
          const home = await sftp.home(targetId)
          await sftp.mkdir({ targetId, path: remoteDir })
          const request = { targetId, destinationDir: remoteDir, overwrite: false }
          const upload = await sftp.upload({ ...request, transferId: 'up-1', sources })
          const conflict = await sftp.upload({ ...request, transferId: 'up-2', sources })
          const listing = await sftp.list({ targetId, path: remoteDir })
          const download = await sftp.download({
            transferId: 'down-1',
            targetId,
            sources: [`${remoteDir}/hello.txt`, `${remoteDir}/nested`],
            destinationDir: inbox,
            overwrite: false
          })
          return { home, upload, conflict, listing, download }
        },
        {
          targetId,
          remoteDir: REMOTE_DIR,
          sources: [path.join(outbox, 'hello.txt'), path.join(outbox, 'nested')],
          inbox
        }
      )

      expect(result.home).toEqual({ ok: true, value: '/root' })
      expect(result.upload).toEqual({ ok: true, value: { status: 'done' } })
      expect(result.conflict).toEqual({
        ok: true,
        value: { status: 'conflict', conflicts: ['hello.txt', 'nested'] }
      })
      expect(result.listing.ok && result.listing.value.map((entry) => entry.name)).toEqual([
        'nested',
        'hello.txt'
      ])
      expect(execDockerSshRelayTargetCommand(target, `cat ${REMOTE_DIR}/nested/deep.txt`)).toBe(
        'deep'
      )
      expect(result.download).toEqual({ ok: true, value: { status: 'done' } })
      expect(readFileSync(path.join(inbox, 'hello.txt'), 'utf8')).toBe('hello sftp')
      expect(readFileSync(path.join(inbox, 'nested', 'deep.txt'), 'utf8')).toBe('deep')
      expect(existsSync(path.join(inbox, 'hello.txt.orca-download'))).toBe(false)

      // Why: SFTP runs on its own connection; the relay's per-host status must not claim one.
      const relayStatus = await orcaPage.evaluate(
        (id) => window.__store?.getState().sshConnectionStates.get(id)?.status ?? null,
        targetId
      )
      expect(relayStatus).not.toBe('connected')

      const removal = await orcaPage.evaluate(
        async ({ targetId, remoteDir }) => window.api.sftp.remove({ targetId, paths: [remoteDir] }),
        { targetId, remoteDir: REMOTE_DIR }
      )
      expect(removal).toEqual({ ok: true, value: undefined })
      expect(
        execDockerSshRelayTargetCommand(target, `test -e ${REMOTE_DIR} && echo yes || echo no`)
      ).toBe('no')

      execDockerSshRelayTargetCommand(target, 'touch /root/orca-sftp-visible.txt')
      await orcaPage.getByRole('button', { name: 'SFTP', exact: true }).click()
      await orcaPage.locator('[data-ssh-host-row]').filter({ hasText: 'Docker SFTP E2E' }).click()
      await expect(orcaPage.locator('[data-sftp-entry^="/root/"]').first()).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.screenshot({ path: testInfo.outputPath('sftp-page.png') })

      // Leaving the page and coming back keeps the host, folder and listing.
      const sftpPage = orcaPage.locator('[data-sftp-page]')
      await sftpPage.locator('[data-sftp-entry="/root/.ssh"]').dblclick()
      const remotePath = sftpPage.locator('input[aria-label="Path"]').nth(1)
      await expect(remotePath).toHaveValue('/root/.ssh')
      await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
      await expect(sftpPage).toBeHidden()
      await orcaPage.getByRole('button', { name: 'SFTP', exact: true }).click()
      await expect(remotePath).toHaveValue('/root/.ssh')
      await expect(sftpPage.locator('[data-sftp-entry="/root/.ssh/authorized_keys"]')).toBeVisible()
    } finally {
      cleanupDockerSshRelayTarget(target)
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})
