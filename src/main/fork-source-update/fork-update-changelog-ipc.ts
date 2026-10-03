import { app, BrowserWindow, ipcMain } from 'electron'
import { runProcess } from '../../shared/child-process/run-process'
import type { ForkUpdateChangelog } from '../../shared/fork-update-changelog'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'
import { readForkSourceIdentity, type ForkSourceIdentity } from './fork-source-identity'
import { fetchUpstreamReleaseNotes } from './fork-source-release-notes'
import { planChangelogAgent, runChangelogAgent } from './fork-update-changelog-agent'
import { listNewForkCommits, parseLocalBuildCommit } from './fork-update-changelog-commits'
import {
  createForkChangelogFileStore,
  type ForkChangelogFile,
  type ForkChangelogLaunch
} from './fork-update-changelog-file'
import { buildForkChangelogPrompt } from './fork-update-changelog-prompt'
import { ForkUpdateChangelogService } from './fork-update-changelog-service'

const CHANNELS = {
  get: 'forkChangelog:get',
  ensureSummary: 'forkChangelog:ensureSummary',
  regenerate: 'forkChangelog:regenerate',
  markSeen: 'forkChangelog:markSeen',
  changed: 'forkChangelog:changed'
} as const
const GIT_TIMEOUT_MS = 30_000
const LOCALE_PATTERN = /^[A-Za-z0-9-]{1,64}$/
/** Dev-only replay of one update, e.g. `v1.4.218@e1d7c76c5c..v1.4.219@f0feeec927`. */
const DEV_PREVIEW_PATTERN = /^(v\d+\.\d+\.\d+)(?:@(\w+))?\.\.(v\d+\.\d+\.\d+)(?:@(\w+))?$/

type ServiceSetup = {
  identity: ForkSourceIdentity
  current: ForkChangelogLaunch
  files: { read: () => ForkChangelogFile; write: (file: ForkChangelogFile) => void }
}

let service: ForkUpdateChangelogService | null | undefined

function parseLocale(raw: unknown): string {
  return typeof raw === 'string' && LOCALE_PATTERN.test(raw) ? raw : 'en'
}

function publish(changelog: ForkUpdateChangelog | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(CHANNELS.changed, changelog)
    }
  }
}

function resolveDevPreviewSetup(): ServiceSetup | null {
  const match = DEV_PREVIEW_PATTERN.exec(process.env.ORCA_DEV_FORK_CHANGELOG ?? '')
  if (app.isPackaged || !match) {
    return null
  }
  const [, fromTag, fromCommit, toTag, toCommit] = match
  const identity = {
    repoRoot: process.cwd(),
    branch: 'HEAD',
    baseTag: toTag,
    upstreamRemote: 'origin',
    forkRemote: 'fork'
  }
  let file: ForkChangelogFile = {
    lastLaunch: { baseTag: fromTag, commit: fromCommit ?? null },
    changelog: null
  }
  return {
    identity,
    current: { baseTag: toTag, commit: toCommit ?? null },
    files: { read: () => file, write: (next) => (file = next) }
  }
}

function resolveSetup(): ServiceSetup | null {
  const preview = resolveDevPreviewSetup()
  if (preview || !app.isPackaged) {
    return preview
  }
  const identity = readForkSourceIdentity(app.getAppPath())
  if (!identity) {
    return null
  }
  return {
    identity,
    current: { baseTag: identity.baseTag, commit: parseLocalBuildCommit(app.getVersion()) },
    files: createForkChangelogFileStore(app.getPath('userData'))
  }
}

function createService(
  setup: ServiceSetup,
  getSettings: () => GlobalSettings
): ForkUpdateChangelogService {
  const { identity } = setup
  const git = async (args: string[]): Promise<string> => {
    const result = await runProcess({
      program: 'git',
      args,
      cwd: identity.repoRoot,
      env: await resolveLoginShellEnvironment(),
      timeoutMs: GIT_TIMEOUT_MS
    })
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `git exited with ${result.code}`)
    }
    return result.stdout
  }
  return new ForkUpdateChangelogService({
    current: setup.current,
    readFile: setup.files.read,
    writeFile: setup.files.write,
    fetchReleaseNotes: (fromTag, toTag) => fetchUpstreamReleaseNotes(identity, fromTag, toTag),
    listForkCommits: (input) => listNewForkCommits(git, input),
    summarize: async (changelog, locale) => {
      const planned = planChangelogAgent(
        getSettings(),
        buildForkChangelogPrompt({ ...changelog, locale }),
        identity.repoRoot
      )
      return planned.ok ? runChangelogAgent(planned.plan, identity.repoRoot) : planned
    },
    publish,
    now: () => Date.now()
  })
}

/** Fork builds only: the AI changelog shown after updating to a new upstream tag. */
export function registerForkUpdateChangelogHandlers(store: {
  getSettings: () => GlobalSettings
}): void {
  if (service === undefined) {
    const setup = resolveSetup()
    service = setup ? createService(setup, () => store.getSettings()) : null
    service?.start()
  }
  for (const channel of [
    CHANNELS.get,
    CHANNELS.ensureSummary,
    CHANNELS.regenerate,
    CHANNELS.markSeen
  ]) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle(CHANNELS.get, () => service?.get() ?? null)
  ipcMain.handle(CHANNELS.ensureSummary, (_event, locale: unknown) =>
    service?.ensureSummary(parseLocale(locale))
  )
  ipcMain.handle(CHANNELS.regenerate, (_event, locale: unknown) =>
    service?.regenerate(parseLocale(locale))
  )
  ipcMain.handle(CHANNELS.markSeen, () => service?.markSeen())
}
