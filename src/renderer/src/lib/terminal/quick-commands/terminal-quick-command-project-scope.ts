import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { getTerminalQuickCommandScope } from '../../../../../shared/terminal/quick-commands/terminal-quick-commands'
import type { ProjectHostSetup } from '../../../../../shared/project-types'
import type { TerminalQuickCommand } from '../../../../../shared/terminal/quick-commands/terminal-quick-command-types'

type TerminalQuickCommandProjectContext = {
  commandHostId: ExecutionHostId
  projectHostSetups: readonly Pick<ProjectHostSetup, 'hostId' | 'projectId' | 'repoId'>[]
  targetHostId: ExecutionHostId
  targetRepoId: string | null
}

type ProjectResolution =
  | { kind: 'resolved'; projectId: string }
  | { kind: 'ambiguous' }
  | { kind: 'unknown' }

type ProjectSetups = TerminalQuickCommandProjectContext['projectHostSetups']

function findSetupsOnHost(
  setups: ProjectSetups,
  hostId: ExecutionHostId,
  repoId: string
): ProjectSetups {
  return setups.filter((setup) => setup.hostId === hostId && setup.repoId === repoId)
}

function findCommandRepoSetups(
  setups: ProjectSetups,
  commandHostId: ExecutionHostId,
  repoId: string
): ProjectSetups {
  const hostMatches = findSetupsOnHost(setups, commandHostId, repoId)
  // Why: commands belong to a settings host, while its repo can execute through that host's SSH.
  return hostMatches.length > 0 ? hostMatches : setups.filter((s) => s.repoId === repoId)
}

function resolveProject(candidates: ProjectSetups): ProjectResolution {
  const projectIds = new Set(candidates.map((setup) => setup.projectId))
  if (projectIds.size === 0) {
    return { kind: 'unknown' }
  }
  if (projectIds.size > 1) {
    return { kind: 'ambiguous' }
  }
  return { kind: 'resolved', projectId: [...projectIds][0] }
}

export function terminalQuickCommandMatchesWorkspaceProject(
  command: TerminalQuickCommand,
  context: TerminalQuickCommandProjectContext
): boolean {
  const scope = getTerminalQuickCommandScope(command)
  if (scope.type === 'global') {
    return true
  }
  if (context.targetRepoId === null) {
    return false
  }
  if (context.commandHostId === context.targetHostId && scope.repoId === context.targetRepoId) {
    return true
  }

  const commandRepoSetups = findCommandRepoSetups(
    context.projectHostSetups,
    context.commandHostId,
    scope.repoId
  )
  // Why: clones of one remote share a project id; project matching only bridges different hosts.
  if (commandRepoSetups.some((setup) => setup.hostId === context.targetHostId)) {
    return scope.repoId === context.targetRepoId
  }

  const commandProject = resolveProject(commandRepoSetups)
  const targetProject = resolveProject(
    findSetupsOnHost(context.projectHostSetups, context.targetHostId, context.targetRepoId)
  )
  if (commandProject.kind === 'ambiguous' || targetProject.kind === 'ambiguous') {
    return false
  }
  if (commandProject.kind === 'resolved' && targetProject.kind === 'resolved') {
    return commandProject.projectId === targetProject.projectId
  }
  return scope.repoId === context.targetRepoId
}
