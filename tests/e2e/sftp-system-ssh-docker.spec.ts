import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshHostTarget,
  execDockerSshHostTargetCommand,
  startDockerSshHostTarget,
  type DockerSshHostTarget
} from './helpers/docker-ssh-host-target'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const REMOTE_DIR = '/tmp/orca-sftp-system-ssh-e2e'
const LARGE_FILE_BYTES = 5 * 1024 * 1024
const CANCELLED_FILE_MIB = 300
// Why a fixed path: the app is launched with it before the test body can make anything.
const SHIM_DIR = path.join(os.tmpdir(), `orca-e2e-system-ssh-${process.pid}`)
const SHIM_SSH = path.join(SHIM_DIR, 'ssh')
const SHIM_CONFIG = path.join(SHIM_DIR, 'ssh_config')

/** The real ssh with a config of the test's own, so nothing touches the user's known_hosts. */
function writeSshShim(identityFile: string): void {
  mkdirSync(SHIM_DIR, { recursive: true })
  writeFileSync(
    SHIM_CONFIG,
    [
      'Host *',
      `  IdentityFile ${identityFile}`,
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking no',
      '  UserKnownHostsFile /dev/null',
      '  LogLevel ERROR'
    ].join('\n')
  )
  writeFileSync(SHIM_SSH, `#!/bin/sh\nexec /usr/bin/ssh -F '${SHIM_CONFIG}' "$@"\n`, {
    mode: 0o755
  })
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

test.describe('Files of a host behind a ProxyJump, through the system ssh', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')
  test.use({ orcaAppExtraEnv: { ORCA_SYSTEM_SSH_PATH: SHIM_SSH } })

  test('lists, uploads, downloads, deletes and cancels', async ({ orcaPage }, testInfo) => {
    // Starts a Docker sshd, then runs transfers through a real jump into it.
    test.setTimeout(240_000)
    let target: DockerSshHostTarget | null = null
    const localRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-sftp-system-ssh-'))
    try {
      target = startDockerSshHostTarget(testInfo)
      const docker = target
      writeSshShim(docker.identityFile)
      execDockerSshHostTargetCommand(
        docker,
        `rm -rf ${REMOTE_DIR}; mkdir -p ${REMOTE_DIR}; head -c ${CANCELLED_FILE_MIB}M /dev/zero > /tmp/orca-cancelled.bin`
      )
      const outbox = path.join(localRoot, 'outbox')
      const inbox = path.join(localRoot, 'inbox')
      mkdirSync(path.join(outbox, 'nested'), { recursive: true })
      mkdirSync(inbox)
      const large = randomBytes(LARGE_FILE_BYTES)
      writeFileSync(path.join(outbox, 'large.bin'), large)
      writeFileSync(path.join(outbox, 'nested', 'deep.txt'), 'deep')

      await waitForSessionReady(orcaPage)
      // Why 127.0.0.1:22: that is the container itself only as seen from the jump host, so a host
      // reached here can only have been reached through the jump.
      const label = `Docker jump E2E ${Date.now()}`
      const targetId = await orcaPage.evaluate(
        async ({ hostLabel, jumpPort, identityFile }) => {
          const result = await window.api.ssh.addTarget({
            target: {
              label: hostLabel,
              host: '127.0.0.1',
              port: 22,
              username: 'root',
              identityFile,
              identitiesOnly: true,
              jumpHost: `root@127.0.0.1:${jumpPort}`
            }
          })
          return result.target.id
        },
        { hostLabel: label, jumpPort: docker.port, identityFile: docker.identityFile }
      )

      const result = await orcaPage.evaluate(
        async ({ id, remoteDir, sources, into }) => {
          const { sftp } = window.api
          const run = async (request: Parameters<typeof sftp.plan>[0], transferId: string) => {
            const planned = await sftp.plan(request)
            return planned.ok ? sftp.execute({ planId: planned.value.planId, transferId }) : planned
          }
          const home = await sftp.home(id)
          const upload = await run(
            { kind: 'upload', targetId: id, sources, destinationDir: remoteDir },
            'up-1'
          )
          const listing = await sftp.list({ targetId: id, path: remoteDir })
          const missing = await sftp.list({ targetId: id, path: `${remoteDir}/not-there` })
          const download = await run(
            {
              kind: 'download',
              targetId: id,
              sources: [`${remoteDir}/large.bin`, `${remoteDir}/nested`],
              destinationDir: into
            },
            'down-1'
          )
          const mkdir = await run(
            { kind: 'mkdir', targetId: id, path: `${remoteDir}/made/here` },
            'mk-1'
          )
          const rename = await run(
            {
              kind: 'rename',
              targetId: id,
              from: `${remoteDir}/nested/deep.txt`,
              to: `${remoteDir}/nested/renamed.txt`
            },
            'mv-1'
          )
          const stillThere = await sftp.list({ targetId: id, path: `${remoteDir}/nested` })
          return { home, upload, listing, missing, download, mkdir, rename, stillThere }
        },
        {
          id: targetId,
          remoteDir: REMOTE_DIR,
          sources: [path.join(outbox, 'large.bin'), path.join(outbox, 'nested')],
          into: inbox
        }
      )

      const done = { ok: true, value: { status: 'done' } }
      expect(result.home).toEqual({ ok: true, value: '/root' })
      expect(result.upload).toEqual(done)
      expect(result.listing.ok && result.listing.value.map((entry) => entry.name)).toEqual([
        'nested',
        'large.bin'
      ])
      expect(result.listing.ok && result.listing.value[1]?.size).toBe(LARGE_FILE_BYTES)
      expect(result.listing.ok && result.listing.value[1]?.owner).toBe('root')
      expect(result.missing.ok).toBe(false)

      // Chunks finish out of order, so the bytes are compared both ways.
      expect(
        execDockerSshHostTargetCommand(docker, `sha256sum ${REMOTE_DIR}/large.bin | cut -d' ' -f1`)
      ).toBe(sha256(large))
      expect(result.download).toEqual(done)
      expect(sha256(readFileSync(path.join(inbox, 'large.bin')))).toBe(sha256(large))
      expect(readFileSync(path.join(inbox, 'nested', 'deep.txt'), 'utf8')).toBe('deep')
      expect(result.mkdir).toEqual(done)
      expect(result.rename).toEqual(done)
      expect(result.stillThere.ok && result.stillThere.value.map((entry) => entry.name)).toEqual([
        'renamed.txt'
      ])
      expect(
        execDockerSshHostTargetCommand(docker, `test -d ${REMOTE_DIR}/made/here && echo yes`)
      ).toBe('yes')

      // Cancelling part way stops that transfer only: nothing is left behind, and browsing works.
      const cancelled = await orcaPage.evaluate(
        async ({ id, into }) => {
          const { sftp } = window.api
          const planned = await sftp.plan({
            kind: 'download',
            targetId: id,
            sources: ['/tmp/orca-cancelled.bin'],
            destinationDir: into
          })
          if (!planned.ok) {
            return { outcome: planned, sawProgress: false, afterwards: null }
          }
          let sawProgress = false
          const stopListening = sftp.onProgress(({ transferId }) => {
            if (transferId === 'big-1' && !sawProgress) {
              sawProgress = true
              void sftp.cancel('big-1')
            }
          })
          const outcome = await sftp.execute({ planId: planned.value.planId, transferId: 'big-1' })
          stopListening()
          const afterwards = await sftp.list({ targetId: id, path: '/tmp' })
          return { outcome, sawProgress, afterwards }
        },
        { id: targetId, into: inbox }
      )
      expect(cancelled.sawProgress).toBe(true)
      expect(cancelled.outcome).toEqual({ ok: true, value: { status: 'cancelled' } })
      expect(cancelled.afterwards?.ok).toBe(true)
      expect(readdirSync(inbox).sort()).toEqual(['large.bin', 'nested'])

      const removal = await orcaPage.evaluate(
        async ({ id, remoteDir }) => {
          const planned = await window.api.sftp.plan({
            kind: 'remove',
            targetId: id,
            paths: [remoteDir]
          })
          return planned.ok
            ? window.api.sftp.execute({ planId: planned.value.planId, transferId: 'rm-1' })
            : planned
        },
        { id: targetId, remoteDir: REMOTE_DIR }
      )
      expect(removal).toEqual(done)
      expect(
        execDockerSshHostTargetCommand(docker, `test -e ${REMOTE_DIR} && echo yes || echo no`)
      ).toBe('no')

      // The files pane itself lists the host, where it used to refuse it.
      await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
      const sshPage = orcaPage.locator('[data-ssh-page]')
      await sshPage.locator('[data-remote-side-tab="hosts"]').click()
      const hostRow = sshPage.locator('[data-ssh-host-row]').filter({ hasText: label })
      await hostRow.hover()
      await sshPage.locator('[data-ssh-host-open="files"]').filter({ visible: true }).click()
      const remotePane = orcaPage.locator('[data-sftp-pane="remote"]')
      await expect(remotePane.locator('input[aria-label="Path"]')).toHaveValue('/root', {
        timeout: 30_000
      })
      await expect(remotePane.locator('[data-sftp-entry="/root/.bashrc"]')).toBeVisible()
      await orcaPage.screenshot({ path: testInfo.outputPath('sftp-through-jump.png') })
    } finally {
      cleanupDockerSshHostTarget(target)
      rmSync(localRoot, { recursive: true, force: true })
      rmSync(SHIM_DIR, { recursive: true, force: true })
    }
  })
})
