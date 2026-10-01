import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { joinPath } from '@/lib/path'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { confirmSharedRunConfigurations } from '@/lib/ensure-hooks-confirmed'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type {
  CommandRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunConfigurationKind } from '../../../../shared/run-configurations/run-configuration-types'
import {
  planRunConfiguration,
  type RunLaunchPlan
} from '../../../../shared/run-configurations/run-configuration-plan'
import {
  resolveCommandLaunch,
  resolveDebugLaunch
} from '../../../../shared/run-configurations/run-configuration-resolve'
import type { RunConfigurationVariableContext } from '../../../../shared/run-configurations/run-configuration-variables'
import {
  parseOrcaYamlRunConfigurations,
  runConfigurationsTrustContent
} from '../../../../shared/run-configurations/orca-yaml-run-configurations'
import { debugLaunchTarget } from '../debug/debug-launch'
import { worktreeProjectFiles } from './project-run-detection'
import {
  exitFailureMessage,
  planErrorMessage,
  resolvedOrToast
} from './run-configuration-launch-messages'
import {
  runConfiguration,
  runConfigurationAndWait,
  type RunTarget
} from './run-configuration-control'
import { combineRunConfigurations, useRunConfigurationStore } from './run-configuration-store'
import { runConfigurationKindOf } from './run-mode'
import { configurationCommandKey, configurationItemKey } from './run-widget-items'

/** The run target a command configuration uses; its key keeps one terminal tab per configuration. */
export function configurationRunTarget(
  configuration: CommandRunConfiguration,
  launch: { command: string; cwd: string },
  worktreeId: string,
  groupId: string | null,
  kind?: RunConfigurationKind
): RunTarget {
  const commandKey = configurationCommandKey(configuration.id)
  return {
    worktreeId,
    groupId,
    commandKey,
    cwd: launch.cwd,
    ...(kind ? { kind } : {}),
    command: {
      id: commandKey,
      label: configuration.name,
      command: launch.command,
      appendEnter: true
    }
  }
}

const latestSharedLoad = new Map<string, number>()

/** Reads `runConfigurations:` from the workspace's own orca.yaml (it can differ per branch). */
export async function loadSharedRunConfigurations(worktreeId: string): Promise<void> {
  const workspace = worktreeProjectFiles(worktreeId)
  if (!workspace) {
    return
  }
  const token = (latestSharedLoad.get(worktreeId) ?? 0) + 1
  latestSharedLoad.set(worktreeId, token)
  const store = useRunConfigurationStore.getState()
  const previous = store.sharedByWorktree[worktreeId]
  store.setShared(worktreeId, {
    status: 'loading',
    configurations: previous?.configurations ?? [],
    problems: previous?.problems ?? []
  })
  const text = await workspace.files.readText(joinPath(workspace.root, 'orca.yaml'))
  // Why: an older, slower read must not overwrite a newer one.
  if (latestSharedLoad.get(worktreeId) !== token) {
    return
  }
  useRunConfigurationStore.getState().setShared(worktreeId, {
    status: 'ready',
    ...(text ? parseOrcaYamlRunConfigurations(text) : { configurations: [], problems: [] })
  })
}

function activeFileIn(worktreeId: string): string | undefined {
  const state = useAppStore.getState()
  const fileId = state.activeFileIdByWorktree[worktreeId]
  const file = fileId ? state.openFiles.find((candidate) => candidate.id === fileId) : undefined
  return file?.mode === 'edit' ? file.filePath : undefined
}

/** A launch still running Before launch steps or starting compound members. */
type PendingLaunch = { worktreeId: string; reference: string; cancelled: boolean }

const pendingLaunches = new Set<PendingLaunch>()

/** Keeps launches in progress from starting anything more; without a reference, all in the worktree. */
export function cancelPendingLaunches(worktreeId: string, reference?: string): void {
  for (const pending of pendingLaunches) {
    if (
      pending.worktreeId === worktreeId &&
      (reference === undefined || pending.reference === reference)
    ) {
      pending.cancelled = true
    }
  }
}

type LaunchScope = {
  worktreeId: string
  groupId: string | null
  context: RunConfigurationVariableContext
  pending: PendingLaunch
  /** Kinds by configuration id; publishes reach the launcher already turned into commands. */
  kinds: ReadonlyMap<string, RunConfigurationKind>
}

function launchRunTarget(
  configuration: CommandRunConfiguration,
  launch: { command: string; cwd: string },
  scope: LaunchScope
): RunTarget {
  return configurationRunTarget(
    configuration,
    launch,
    scope.worktreeId,
    scope.groupId,
    scope.kinds.get(configuration.id)
  )
}

/** Runs a command to completion; false (after a toast) unless it exited 0. */
async function runToSuccess(
  step: CommandRunConfiguration,
  scope: LaunchScope,
  role: 'step' | 'member'
): Promise<boolean> {
  const launch = resolvedOrToast(resolveCommandLaunch(step, scope.context), step.name)
  if (!launch) {
    return false
  }
  const exit = await runConfigurationAndWait(launchRunTarget(step, launch, scope))
  if (scope.pending.cancelled) {
    return false
  }
  // `finished` is a clean end from a shell that reports no exit code.
  if (exit.status === 'succeeded' || exit.status === 'finished') {
    return true
  }
  toast.error(exitFailureMessage(role, step.name, exit))
  return false
}

/** Each step must exit 0 before the next; a failure or stop ends the whole launch. */
async function runBeforeLaunchSteps(
  steps: readonly CommandRunConfiguration[],
  scope: LaunchScope
): Promise<boolean> {
  for (const step of steps) {
    if (scope.pending.cancelled || !(await runToSuccess(step, scope, 'step'))) {
      return false
    }
  }
  return !scope.pending.cancelled
}

function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

/** Starts launches in order, honouring each one's wait; a failed wait stops the rest. */
async function startSequentially(plan: RunLaunchPlan, scope: LaunchScope): Promise<void> {
  for (const launch of plan.launches) {
    if (scope.pending.cancelled) {
      return
    }
    const wait = plan.waitAfter[launch.id]
    // Why command only: a debug session has no exit the launcher can wait on.
    if (wait?.kind === 'exit' && launch.type === 'command') {
      if (!(await runToSuccess(launch, scope, 'member'))) {
        return
      }
      continue
    }
    await startLaunch(launch, scope)
    if (wait?.kind === 'delay') {
      await delay(wait.seconds)
    }
  }
}

async function startLaunch(
  configuration: RunConfigurationDefinition,
  scope: LaunchScope
): Promise<void> {
  if (configuration.type === 'command') {
    const launch = resolvedOrToast(
      resolveCommandLaunch(configuration, scope.context),
      configuration.name
    )
    if (launch) {
      await runConfiguration(launchRunTarget(configuration, launch, scope))
    }
    return
  }
  if (configuration.type === 'debug') {
    const launch = resolvedOrToast(
      resolveDebugLaunch(configuration, scope.context),
      configuration.name
    )
    if (launch) {
      await debugLaunchTarget({
        worktreeId: scope.worktreeId,
        title: configuration.name,
        // Why its own key: a compound member's row and the compound both find it by this key.
        sourceKey: configurationItemKey(configuration.id),
        ...launch
      })
    }
  }
}

// Why: orca.yaml comes from the repo, so a clone must not be able to run commands unapproved.
function confirmShared(
  repo: Repo,
  shared: readonly RunConfigurationDefinition[]
): Promise<'run' | 'skip'> {
  return confirmSharedRunConfigurations(
    useAppStore.getState(),
    repo.id,
    runConfigurationsTrustContent(shared),
    getRepoExecutionHostId(repo)
  )
}

/** Runs a saved configuration: trust check for orca.yaml ones, Before launch steps, then launch. */
export async function launchRunConfiguration(options: {
  worktreeId: string
  groupId: string | null
  reference: string
}): Promise<void> {
  // Why: running it again replaces a launch of it that is still starting members.
  cancelPendingLaunches(options.worktreeId, options.reference)
  const pending: PendingLaunch = {
    worktreeId: options.worktreeId,
    reference: options.reference,
    cancelled: false
  }
  pendingLaunches.add(pending)
  try {
    await launchPlanned(options, pending)
  } finally {
    pendingLaunches.delete(pending)
  }
}

async function launchPlanned(
  options: { worktreeId: string; groupId: string | null; reference: string },
  pending: PendingLaunch
): Promise<void> {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, options.worktreeId)
  const repo = worktree
    ? state.repos.find((candidate) => candidate.id === worktree.repoId)
    : undefined
  if (!worktree || !repo) {
    return
  }
  // Why reload: orca.yaml may have changed (branch switch, pull) since the menu last read it.
  await loadSharedRunConfigurations(options.worktreeId)
  const store = useRunConfigurationStore.getState()
  const shared = store.sharedByWorktree[options.worktreeId]?.configurations ?? []
  const listed = combineRunConfigurations(store.localByRepo[repo.id] ?? [], shared)
  const result = planRunConfiguration(
    listed.map((entry) => entry.configuration),
    options.reference
  )
  if (!result.ok) {
    toast.error(planErrorMessage(result.error.code, result.error.reference))
    return
  }
  const involvedIds = new Set(result.plan.involvedIds)
  const usesShared = listed.some(
    (entry) => entry.source === 'shared' && involvedIds.has(entry.configuration.id)
  )
  if (usesShared && (await confirmShared(repo, shared)) !== 'run') {
    return
  }
  const scope: LaunchScope = {
    worktreeId: options.worktreeId,
    groupId: options.groupId,
    context: {
      workspaceFolder: worktree.path,
      file: activeFileIn(options.worktreeId)
    },
    pending,
    kinds: new Map(
      listed.flatMap(({ configuration }) => {
        const kind = runConfigurationKindOf(configuration)
        return kind ? [[configuration.id, kind] as const] : []
      })
    )
  }
  if (!(await runBeforeLaunchSteps(result.plan.beforeLaunch, scope))) {
    return
  }
  if (result.plan.sequential) {
    await startSequentially(result.plan, scope)
    return
  }
  await Promise.all(result.plan.launches.map((launch) => startLaunch(launch, scope)))
}
