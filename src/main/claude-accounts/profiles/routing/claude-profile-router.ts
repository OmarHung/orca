import { claudeAccountUsagePreparation } from './claude-account-usage-preparation'
import { claudeProfileSelectionHomes } from './claude-profile-selection-homes'
import { prepareClaudeProfileForLaunch } from './claude-profile-launch-preparation'
import { getClaudeAgentViewService } from '../../../claude/agent-view/agent-view-service'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isAgentStatusHooksEnabledForAgent } from '../../../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_PROFILE_SETUP_FAILED_MESSAGE,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../../../shared/agent-accounts/claude/claude-profile-routing'
import { claudeProfileMissing } from './claude-profile-launch-errors'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import type { ClaudeManagedAccount } from '../../../../shared/agent-accounts/managed-account-types'
import { probeRecentClaudeCliVersion } from '../../../claude/cli-capabilities/claude-hook-event-versions'
import { ClaudeProfilePointers, type LaunchProject } from './claude-project-pointers'
import { resolveClaudeCommand } from '../../../codex-cli/command'
import {
  describeClaudeProfile,
  type ClaudeProfileDescriptor,
  readUserClaudeConfigDir,
  readUserClaudeConfigDirAsSet,
  resolveClaudeDefaultHome
} from '../claude-profile-paths'
import type { ClaudeProfileSetupReport } from '../setup/claude-profile-setup'
import { runClaudeProfileSetupInWorker } from '../setup/claude-profile-setup-worker'
import type { ClaudeEnvPatch } from '../../runtime-auth/environment'
import type { ClaudeRuntimeAuthPreparation } from '../../runtime-auth/runtime-auth-types'
import {
  findClaudeAccount,
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from '../../selection/runtime-selection'
import { wslClaudeProfilePointer } from '../wsl/claude-profile-wsl-paths'
import { isDirectory, listClaudeProfileHomes } from '../claude-profile-homes'
import {
  claudeStateFile,
  readClaudeFolderLogin,
  removeClaudeAccountFolder,
  isSameClaudeLogin,
  type ClaudeFolderLogin
} from '../../sign-in/claude-account-folder'
import { resolveLoginShellEnvironment } from '../../../startup/shell-environment/login-shell-environment'

export type ClaudeProfileRouterSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'agentStatusHooksEnabled'
  | 'disabledTuiAgents'
>

/** Mirror the settings selection to a pointer file for Claude in existing terminals. */
export class ClaudeProfileRouter {
  readonly pointerPath: string
  private readonly pointers: ClaudeProfilePointers
  private readonly setups = new Map<string, Promise<ClaudeProfileSetupReport>>()
  private env: NodeJS.ProcessEnv
  private readonly envReady: Promise<unknown>
  private envResolved: boolean
  constructor(
    private readonly args: {
      getSettings: () => ClaudeProfileRouterSettings
      dataRoot: string
      userHome?: string
      env?: NodeJS.ProcessEnv
      runSetup?: typeof runClaudeProfileSetupInWorker
      refreshWaitMs?: number
      /** A project's pinned account on this host (null id: System default); null follows Accounts. */
      getProjectAccount?: (repoId: string) => { accountId: string | null } | null
    }
  ) {
    this.pointers = new ClaudeProfilePointers(args.dataRoot, (p) => this.routedProfile(p)?.home)
    this.pointerPath = this.pointers.globalPath
    this.env = args.env ?? process.env
    // Dock launches lack CLAUDE_CONFIG_DIR exported by shell startup files.
    this.envResolved = Boolean(args.env)
    this.envReady = args.env
      ? Promise.resolve()
      : resolveLoginShellEnvironment().then((env) => {
          this.env = env
          this.envResolved = true
          // Recompute routing using the resolved System default.
          try {
            this.writePointer()
          } catch (error) {
            console.warn('[claude-profile] Could not update the Claude account pointer:', error)
          }
        })
  }

  get userHome(): string {
    return this.args.userHome ?? homedir()
  }

  /** A launch's project replaces the Accounts selection when it pins its own account. */
  selectedProfile(project?: LaunchProject): ClaudeProfileDescriptor | null {
    const pinned = project && this.args.getProjectAccount?.(project.repoId)
    const id = pinned
      ? pinned.accountId
      : getSelectedClaudeAccountIdForTarget(this.args.getSettings(), { runtime: 'host' })
    return id ? this.describe(id) : null
  }

  private routedProfile(project?: LaunchProject): ClaudeProfileDescriptor | null {
    const profile = this.selectedProfile(project)
    return profile && !this.coveredBySystemDefault(profile.accountId) ? profile : null
  }

  accountLogin(accountId: string): ClaudeFolderLogin | null {
    return readClaudeFolderLogin(claudeStateFile(this.accountHome(accountId), this.userHome))
  }

  systemDefaultLogin(maxAgeMs = 0): ClaudeFolderLogin | null {
    return readClaudeFolderLogin(claudeStateFile(this.userConfigDir(), this.userHome), maxAgeMs)
  }

  /** Reuse a matching System default login until a legacy account signs in separately. */
  coveredBySystemDefault(accountId: string): boolean {
    if (this.accountLogin(accountId)) {
      return false
    }
    const saved = this.savedAccount(accountId)
    const systemDefault = this.systemDefaultLogin()
    return Boolean(saved && systemDefault && isSameClaudeLogin(saved, systemDefault))
  }

  savedAccount(accountId: string): ClaudeManagedAccount | undefined {
    return findClaudeAccount(this.args.getSettings(), accountId)
  }

  systemDefaultHome(): string {
    return resolveClaudeDefaultHome(this.userHome, this.userConfigDir())
  }

  /** Never fall back from a missing folder: that would run the wrong account. `identity` names
   *  the selected route before its folder exists; launches and reads still check availability. */
  routedHome(
    availability: 'checked' | 'identity' = 'checked',
    project?: LaunchProject
  ): string | null {
    const home = this.routedProfile(project)?.home ?? null
    if (availability === 'checked' && home !== null && !isDirectory(home)) {
      throw claudeProfileMissing()
    }
    return home
  }

  /** Publish the pointer before starting background setup; with a project, after its pick changes. */
  publish(project?: LaunchProject): void {
    if (!this.writePointer(project)) {
      return
    }
    // Create missing or covered folders without a login so they can sign in separately.
    const profile = this.selectedProfile(project)
    if (profile) {
      this.setUpInBackground(profile)
    }
  }

  private writePointer(project?: LaunchProject): boolean {
    if (this.args.getSettings().claudeManagedAccounts.length === 0) {
      this.pointers.clear()
      return false
    }
    this.pointers.sync(project)
    return true
  }

  private setUpInBackground(profile: ClaudeProfileDescriptor): void {
    this.setUp(profile).catch((error: unknown) => {
      console.warn('[claude-profile] Account setup failed:', error)
    })
  }

  /** Initial setup must succeed; later refreshes may time out without blocking launch. */
  async prepareLaunch(project?: LaunchProject): Promise<ClaudeRuntimeAuthPreparation> {
    const selected = this.selectedProfile(project)
    // Only fallback routing needs the shell env; account setup waits for it separately.
    if (!selected || !this.accountLogin(selected.accountId)) {
      await this.envReady
    }
    // Login changes since publication can change the route.
    this.writePointer(project)
    const profile = this.routedProfile(project)
    if (!profile) {
      return this.preparation(project)
    }
    await prepareClaudeProfileForLaunch(
      profile,
      (value) => this.setUp(value),
      this.args.refreshWaitMs
    )
    return this.preparation(project)
  }

  accountHome(accountId: string): string {
    return this.describe(accountId).home
  }

  async prepareAccount(accountId: string): Promise<string> {
    const profile = this.describe(accountId)
    const report = await this.setUp(profile).catch(() => null)
    if (report?.outcome !== 'prepared') {
      throw new Error(CLAUDE_PROFILE_SETUP_FAILED_MESSAGE)
    }
    return profile.home
  }

  /** Wait for setup before deleting so it cannot recreate the folder. */
  async removeAccount(accountId: string): Promise<void> {
    await this.setups.get(accountId)?.catch(() => {})
    await removeClaudeAccountFolder(this.args.dataRoot, accountId)
  }

  /** A legacy snapshot records copy-based account switching. */
  copiedLoginIntoSystemDefault(): boolean {
    return existsSync(join(this.args.dataRoot, 'claude-runtime-auth', 'system-default-auth.json'))
  }

  userConfigDir(): string | undefined {
    return readUserClaudeConfigDir(this.env)
  }

  private describe(accountId: string): ClaudeProfileDescriptor {
    return describeClaudeProfile(this.args.dataRoot, accountId, {
      executionHostId: 'local',
      runtime: 'host'
    })
  }

  /** Reuse in-flight setup per account. */
  private setUp(profile: ClaudeProfileDescriptor): Promise<ClaudeProfileSetupReport> {
    const running = this.setups.get(profile.accountId)
    if (running) {
      return running
    }
    const run = this.runSetup(profile).finally(() => this.setups.delete(profile.accountId))
    this.setups.set(profile.accountId, run)
    return run
  }

  private async runSetup(profile: ClaudeProfileDescriptor): Promise<ClaudeProfileSetupReport> {
    await this.envReady
    const hooks = isAgentStatusHooksEnabledForAgent(this.args.getSettings(), 'claude')
    const claudeVersion = hooks ? await probeRecentClaudeCliVersion(resolveClaudeCommand()) : null
    const report = await (this.args.runSetup ?? runClaudeProfileSetupInWorker)({
      dataRoot: this.args.dataRoot,
      profile,
      userHome: this.userHome,
      userConfigDir: this.userConfigDir(),
      hooks,
      claudeVersion: claudeVersion ?? undefined
    })
    if (report.outcome === 'prepared') {
      await getClaudeAgentViewService(this.args.dataRoot).prepareProfile(profile.home)
    }
    if (report.outcome === 'refused' || report.warnings.length > 0) {
      console.warn('[claude-profile] Account setup was incomplete:', report)
    }
    return report
  }

  launchEnv(project?: LaunchProject): ClaudeEnvPatch {
    const home = this.routedHome('checked', project)
    return {
      [CLAUDE_PROFILE_POINTER_ENV]: this.pointers.path(project),
      // Preserve the user's inherited CLAUDE_CONFIG_DIR for System default.
      ...(home ? { CLAUDE_CONFIG_DIR: home, [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home } : {})
    }
  }

  /** A broken account selection must not prevent opening a terminal. */
  terminalEnv(target?: ClaudeAccountSelectionTarget, project?: LaunchProject): ClaudeEnvPatch {
    // Pass the pointer without waiting on the guest.
    if (target?.runtime === 'wsl') {
      return { [CLAUDE_PROFILE_POINTER_ENV]: `~/${wslClaudeProfilePointer(this.args.dataRoot)}` }
    }
    // Save the user's value so the shell function can restore it on System default.
    const userConfigDir = readUserClaudeConfigDirAsSet(this.env)
    const base: ClaudeEnvPatch = {
      [CLAUDE_PROFILE_POINTER_ENV]: this.pointers.path(project),
      ...(userConfigDir ? { [CLAUDE_USER_CONFIG_DIR_ENV]: userConfigDir } : {})
    }
    // Defer routing until the shell env resolves; the shell function will read the updated pointer.
    if (!this.envResolved) {
      this.pointers.tryWrite(project)
      return base
    }
    try {
      this.writePointer(project)
      // Refresh without delaying terminal creation.
      const profile = this.routedProfile(project)
      if (profile) {
        this.setUpInBackground(profile)
      }
      return { ...base, ...this.launchEnv(project) }
    } catch {
      return base
    }
  }

  preparation(project?: LaunchProject): ClaudeRuntimeAuthPreparation {
    const profile = this.routedProfile(project)
    const home = this.routedHome('checked', project)
    return {
      configDir: home ?? this.systemDefaultHome(),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: this.launchEnv(project),
      provenance: home ? `profile:${profile?.accountId}` : 'system',
      ...(home && profile
        ? { readingAccount: { accountId: profile.accountId, runtime: 'host', wslDistro: null } }
        : {})
    }
  }

  /** Compare pre-routing terminals against the selection; null means no account is selected. */
  systemDefaultRunsAnotherAccount(): boolean | null {
    const profile = this.selectedProfile()
    if (!profile) {
      return null
    }
    const selected =
      this.accountLogin(profile.accountId) ??
      findClaudeAccount(this.args.getSettings(), profile.accountId)
    const systemDefault = this.systemDefaultLogin(5_000)
    return !selected || !systemDefault || !isSameClaudeLogin(selected, systemDefault)
  }

  routesToAccount(): boolean {
    return this.routedProfile() !== null
  }

  /** Read usage from the same login the account would launch with. */
  accountUsagePreparation(accountId: string): ClaudeRuntimeAuthPreparation {
    return claudeAccountUsagePreparation(this, accountId)
  }

  async accountSelectionHomes(launchEnv: NodeJS.ProcessEnv = process.env): Promise<string[]> {
    return claudeProfileSelectionHomes(this, this.args.getSettings(), this.envReady, launchEnv)
  }

  /** Every account folder on this host, selected or not. */
  accountHomes(): string[] {
    return listClaudeProfileHomes(this.args.dataRoot)
  }
}
