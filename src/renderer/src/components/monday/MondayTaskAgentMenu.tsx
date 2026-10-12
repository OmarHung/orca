import React, { useMemo } from 'react'
import { Copy, FolderPlus, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { orderTabLaunchAgents } from '@/components/tab-bar/tab-agent-launch-options'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { DEFAULT_DISABLED_TUI_AGENTS } from '../../../../shared/tui-agent-selection'
import {
  buildMondayTaskAgentPrompt,
  type MondayTaskAgentPromptInput
} from './monday-task-agent-prompt'
import {
  copyMondayTaskPrompt,
  recentMondayAgentWorkspaces,
  startMondayTaskAgentInNewWorkspace,
  startMondayTaskAgentInWorkspace,
  type MondayAgentTask
} from './monday-task-agent-launch'

function agentLabel(agent: string): string {
  return getAgentCatalog().find((entry) => entry.id === agent)?.label ?? agent
}

/** The agents that workspace's host can run, the default first; picking one starts it there. */
function WorkspaceAgentItems({
  worktreeId,
  prompt
}: {
  worktreeId: string
  prompt: string
}): React.JSX.Element {
  // Why the worktree's own target: SSH and paired-runtime hosts list their agents, not this machine's.
  const { detectedIds } = useDetectedAgents(useAgentDetectionTargetForWorktree(worktreeId))
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  if (detectedIds === null) {
    return (
      <DropdownMenuItem disabled>
        <Loader2 className="size-3.5 animate-spin" />
        {translate('monday.agent.detecting', 'Finding agents…')}
      </DropdownMenuItem>
    )
  }
  const agents = orderTabLaunchAgents(defaultAgent, detectedIds, disabledAgents)
  if (agents.length === 0) {
    return (
      <DropdownMenuItem disabled>
        {translate('monday.agent.noAgents', 'No agents on this host')}
      </DropdownMenuItem>
    )
  }
  return (
    <>
      {agents.map((agent) => (
        <DropdownMenuItem
          key={agent}
          onSelect={() => startMondayTaskAgentInWorkspace({ worktreeId, agent, prompt })}
        >
          <AgentIcon agent={agent} size={14} />
          {agentLabel(agent)}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** Mounted only while the menu is open: a closed panel builds no prompt and skips workspace churn. */
function MenuBody({
  task,
  promptInput
}: {
  task: MondayAgentTask
  promptInput: MondayTaskAgentPromptInput
}): React.JSX.Element {
  const prompt = useMemo(() => buildMondayTaskAgentPrompt(promptInput), [promptInput])
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const lastVisitedAtByWorktreeId = useAppStore((s) => s.lastVisitedAtByWorktreeId)
  const repos = useAppStore((s) => s.repos)
  const workspaces = useMemo(
    () =>
      recentMondayAgentWorkspaces(Object.values(worktreesByRepo).flat(), lastVisitedAtByWorktreeId),
    [worktreesByRepo, lastVisitedAtByWorktreeId]
  )
  const repoNames = useMemo(
    () => new Map(repos.map((repo) => [repo.id, repo.displayName])),
    [repos]
  )
  // Folder projects have no worktrees to add; they show up as existing workspaces instead.
  const gitRepos = useMemo(
    () =>
      repos
        .filter((repo) => isGitRepoKind(repo))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [repos]
  )
  return (
    <>
      <DropdownMenuLabel>
        {translate('monday.agent.inWorkspace', 'New agent in a workspace')}
      </DropdownMenuLabel>
      {workspaces.length === 0 ? (
        <DropdownMenuItem disabled>
          {translate('monday.agent.noWorkspaces', 'No workspaces yet')}
        </DropdownMenuItem>
      ) : null}
      {workspaces.map((workspace) => (
        <DropdownMenuSub key={workspace.id}>
          <DropdownMenuSubTrigger>
            <span className="min-w-0 flex-1 truncate">{workspace.displayName}</span>
            <span className="max-w-24 shrink-0 truncate text-[11px] text-muted-foreground">
              {repoNames.get(workspace.repoId) ?? ''}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[180px]">
            <WorkspaceAgentItems worktreeId={workspace.id} prompt={prompt} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={gitRepos.length === 0}>
          <FolderPlus className="size-3.5" />
          {translate('monday.agent.newWorkspace', 'New workspace in a project')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[180px]">
          <div className="scrollbar-sleek max-h-80 overflow-y-auto">
            {gitRepos.map((repo) => (
              <DropdownMenuItem
                key={repo.id}
                onSelect={() =>
                  void startMondayTaskAgentInNewWorkspace({ repoId: repo.id, task, prompt })
                }
              >
                <span className="truncate">{repo.displayName}</span>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => copyMondayTaskPrompt(prompt)}>
        <Copy className="size-3.5" />
        {translate('monday.agent.copy', 'Copy the task for an agent')}
      </DropdownMenuItem>
    </>
  )
}

/** Hands the task to an AI agent; disabled until the item details have loaded. */
export function MondayTaskAgentMenu({
  task,
  promptInput
}: {
  task: MondayAgentTask
  promptInput: MondayTaskAgentPromptInput | null
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          disabled={promptInput === null}
          data-testid="monday-task-agent-trigger"
        >
          <Sparkles />
          {translate('monday.agent.trigger', 'Hand to AI')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {promptInput ? <MenuBody task={task} promptInput={promptInput} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
