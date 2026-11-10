import { buildAgentStartupPlan } from '../../../shared/agent-launch/startup/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { resolveAgentLaunchExecutionContext } from '@/lib/agent-session/launch/new-tab/launch-agent-execution-context'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import type { WorktreeStartupPayload } from '@/lib/workspace/creation/worktree-startup-payload'
import { findRepoForHost } from '@/store/repos/repo-host-identity'
import type { useAppStore } from '@/store'
import { resolveAgentStartupPlanInputs } from '../../../shared/agent-launch/startup/agent-startup-plan-inputs'
import { resolveRepoInitialTab, type RepoInitialTab } from '../../../shared/repo-initial-tab'
import { isTuiAgentEnabled } from '../../../shared/agent-launch/catalog/tui-agent-selection'
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'

type AppState = ReturnType<typeof useAppStore.getState>

/** The project's initial tab choice; null for workspaces that belong to no known project. */
function resolveProjectInitialTab(state: AppState, worktreeId: string): RepoInitialTab | null {
  const worktree = state.getKnownWorktreeById(worktreeId)
  if (!worktree) {
    return null
  }
  const repo = findRepoForHost(state.repos, worktree.repoId, {
    hostId: getExecutionHostIdForWorktree(state, worktreeId)
  })
  return repo ? resolveRepoInitialTab(repo.initialTab) : null
}

/** True when the project explicitly opens empty workspaces with a plain shell. */
export function projectOpensPlainTerminal(state: AppState, worktreeId: string): boolean {
  return resolveProjectInitialTab(state, worktreeId) === 'terminal'
}

/** The agent an empty workspace of this project opens with, or null for a plain shell. */
export function resolveProjectInitialTabAgent(
  state: AppState,
  worktreeId: string
): TuiAgent | null {
  const initialTab = resolveProjectInitialTab(state, worktreeId)
  if (
    initialTab === null ||
    initialTab === 'terminal' ||
    !isTuiAgentEnabled(initialTab, state.settings?.disabledTuiAgents)
  ) {
    return null
  }
  return initialTab
}

/** Startup for the project's initial agent tab; undefined keeps the plain shell. */
export function buildProjectInitialTabStartup(
  state: AppState,
  worktreeId: string
): WorktreeStartupPayload | undefined {
  const agent = resolveProjectInitialTabAgent(state, worktreeId)
  if (!agent) {
    return undefined
  }
  const launchContext = resolveAgentLaunchExecutionContext(state, { worktreeId })
  // Why: an unknown or withheld host already told the user why; keep the plain shell instead of guessing.
  if (!launchContext || 'unavailable' in launchContext) {
    return undefined
  }
  const { resolvedLaunchPlatform, isRemote } = launchContext
  const settings = state.settings ?? {}
  const plan = buildAgentStartupPlan({
    ...resolveAgentStartupPlanInputs({
      agent,
      settings,
      platform: resolvedLaunchPlatform,
      isRemote,
      // The tab quotes by its Settings shell, which its pane's spawn also reads.
      shell: undefined
    }),
    prompt: '',
    allowEmptyPromptLaunch: true
  })
  if (!plan) {
    return undefined
  }
  return {
    command: plan.launchCommand,
    ...(plan.env ? { env: plan.env } : {}),
    launchConfig: plan.launchConfig,
    launchAgent: agent,
    ...(plan.sessionOptions ? { sessionOptions: plan.sessionOptions } : {}),
    ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {}),
    telemetry: {
      agent_kind: tuiAgentToAgentKind(agent),
      launch_source: 'sidebar',
      request_kind: 'new'
    }
  }
}
