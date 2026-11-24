import type { ClaudeAccountRecipe } from '../../../../shared/agent-session/lifecycle/accounts/agent-session-acquired-account'
import type { ClaudeProfileRouter } from '../../../claude-accounts/profiles/routing/claude-profile-router'
import { applyClaudeEnvPatch } from '../../../claude-accounts/runtime-auth/environment'
import { claudeConfigDirEnvPatch } from './claude-config-dir-pin'
import { resolveStructuredClaudeAccountHomePath } from '../../../runtime/agent-session/environment/structured-agent-account-home'
import { requireLegacyAgentSessionAccountHome } from '../../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { claudeLaunchProjectForWorktree } from '../../../../shared/agent-accounts/claude/claude-project-account'

/** The chat whose launch this is: its own account home, and the project whose pick it follows. */
export type ClaudeLaunchRecord = Pick<AgentSessionRecord, 'accountHome' | 'location'>

/** The account a launch runs under is the current selection, or its project's own account when
 *  it pins one; the receipt records what it used. */
export async function prepareClaudeLaunchAccount(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  record: ClaudeLaunchRecord
): Promise<ClaudeAccountRecipe> {
  const recordHome = requireLegacyAgentSessionAccountHome(record.accountHome).path
  if (!router) {
    return { route: 'system', home: recordHome, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  // WSL chats keep their distro's selection.
  const project = record.location.wslDistro
    ? undefined
    : claudeLaunchProjectForWorktree(record.location.workspaceId)
  const preparation = await router.prepareLaunch(project)
  const home =
    preparation.provenance === 'system'
      ? await resolveStructuredClaudeAccountHomePath({
          launchEnv: env,
          wslDistro: null,
          project,
          getClaudeConfigDirectory: () => router.systemDefaultHome()
        })
      : preparation.configDir
  applyClaudeEnvPatch(env, preparation.envPatch)
  return preparation.provenance.startsWith('profile:')
    ? { route: 'managed', accountId: preparation.provenance.slice('profile:'.length), home }
    : { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
}

/** Pins the account a launch would run under now, without preparing its folder: managed settings
 *  can refuse flags per account, so flag checks must ask as that account. */
export async function withClaudeLaunchAccountPin(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string
): Promise<Record<string, string>> {
  const home = router
    ? await resolveStructuredClaudeAccountHomePath({
        launchEnv: env,
        wslDistro: null,
        purpose: 'identity',
        getClaudeConfigDirectory: () => router.systemDefaultHome()
      })
    : recordHome
  return { ...env, ...claudeConfigDirEnvPatch(home, { env }) }
}
