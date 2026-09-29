import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { resolveAgentLaunchExecutionContext } from '@/lib/launch-agent-execution-context'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import type { WorktreeStartupPayload } from '@/lib/worktree-startup-payload'
import { resolveInitialNativeChatSessionOptions } from '@/components/native-chat/native-chat-launch-session-options'
import { findRepoForHost } from '@/store/slices/repo-host-identity'
import type { useAppStore } from '@/store'
import { resolveAgentStartupPlanInputs } from '../../../shared/agent-startup-plan-inputs'
import { resolveRepoInitialTab, type RepoInitialTab } from '../../../shared/repo-initial-tab'
import { isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../shared/tui-agent'

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
  const { worktreeSshConnectionId, resolvedLaunchPlatform, isRemote } =
    resolveAgentLaunchExecutionContext(state, { worktreeId })
  const settings = state.settings ?? {}
  const sessionOptions = resolveInitialNativeChatSessionOptions(state.settings, {
    agent,
    nativeChatTranscriptIsLocalReadable:
      isNativeChatTranscriptLocalReadable(worktreeSshConnectionId)
  })
  const plan = buildAgentStartupPlan({
    ...resolveAgentStartupPlanInputs({
      agent,
      settings,
      platform: resolvedLaunchPlatform,
      isRemote,
      sessionOptions
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
