import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import { orderEmptyQueryWorktrees } from '@/lib/order-empty-query-worktrees'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { Worktree } from '../../../../shared/worktree/types'

/** How many recent workspaces the hand-off menu offers. */
export const MONDAY_AGENT_WORKSPACE_LIMIT = 10

export type MondayAgentTask = { id: string; name: string; url: string }

/** Workspaces in Cmd+J's empty-query order (focus recency, then activity). */
export function recentMondayAgentWorkspaces(
  worktrees: readonly Worktree[],
  lastVisitedAtByWorktreeId: Record<string, number>
): Worktree[] {
  return orderEmptyQueryWorktrees({
    visibleWorktrees: worktrees.filter((worktree) => !worktree.isArchived),
    activeWorktreeId: null,
    lastVisitedAtByWorktreeId
  }).switchableWorktreesForRows.slice(0, MONDAY_AGENT_WORKSPACE_LIMIT)
}

export function copyMondayTaskPrompt(prompt: string): void {
  window.api.ui.writeClipboardText(prompt).then(
    () => toast.success(translate('monday.agent.copied', 'Copied the task for an agent')),
    () => toast.error(translate('monday.agent.copyFailed', 'Could not copy the task'))
  )
}

/** A new agent tab in an existing workspace, with the task left as an unsent draft. */
export function startMondayTaskAgentInWorkspace(args: {
  worktreeId: string
  agent: TuiAgent
  prompt: string
}): void {
  const { worktreeId, agent, prompt } = args
  let revealFailed = false
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent,
    worktreeId,
    groupId: useAppStore.getState().activeGroupIdByWorktree[worktreeId] ?? worktreeId,
    prompt,
    promptDelivery: 'draft',
    launchSource: 'task_page',
    beforeSurfaceOpen: () => {
      // Why: the launcher owns the initial surface, so revealing must not seed a sibling shell.
      revealFailed =
        activateAndRevealWorktree(worktreeId, { providesInitialSurface: true }) === false
      return !revealFailed
    }
  })
  if (!result) {
    toast.error(
      revealFailed
        ? translate('monday.agent.workspaceUnavailable', 'Could not open that workspace')
        : translate('monday.agent.launchFailed', 'Could not start the agent')
    )
    return
  }
  if (result.surface.kind === 'local-terminal') {
    focusTerminalTabSurface(result.surface.tabId)
  }
}

/**
 * A new workspace in `repoId` with the default agent and the task as its draft. When the project
 * needs choices first (e.g. its setup asks every time), the new-workspace dialog opens instead
 * and the task goes to the clipboard.
 */
export async function startMondayTaskAgentInNewWorkspace(args: {
  repoId: string
  task: MondayAgentTask
  prompt: string
}): Promise<void> {
  const { repoId, task, prompt } = args
  await launchWorkItemDirect({
    item: {
      type: 'issue',
      number: null,
      title: task.name,
      url: task.url,
      pasteContent: prompt,
      workspaceName: `monday-${task.id}`
    },
    repoId,
    launchSource: 'task_page',
    promptDelivery: 'draft',
    openModalFallback: () => {
      useAppStore.getState().openModal('new-workspace-composer', {
        prefilledName: task.name,
        initialRepoId: repoId,
        telemetrySource: 'unknown'
      })
      window.api.ui.writeClipboardText(prompt).then(
        () =>
          toast.info(
            translate(
              'monday.agent.composerFallback',
              'This project needs a few choices first. The task is copied: paste it to the agent once the workspace opens.'
            )
          ),
        () => toast.error(translate('monday.agent.copyFailed', 'Could not copy the task'))
      )
    }
  })
}
