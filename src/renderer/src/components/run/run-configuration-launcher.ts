import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { confirmSharedRunConfigurations } from '@/lib/ensure-hooks-confirmed'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type {
  CommandRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import {
  planRunConfiguration,
  type RunPlanErrorCode
} from '../../../../shared/run-configurations/run-configuration-plan'
import {
  resolveCommandLaunch,
  resolveDebugLaunch,
  type Resolved
} from '../../../../shared/run-configurations/run-configuration-resolve'
import type { RunConfigurationVariableContext } from '../../../../shared/run-configurations/run-configuration-variables'
import {
  parseOrcaYamlRunConfigurations,
  runConfigurationsTrustContent
} from '../../../../shared/run-configurations/orca-yaml-run-configurations'
import { debugLaunchTarget } from '../debug/debug-launch'
import { worktreeProjectFiles } from './project-run-detection'
import {
  runConfiguration,
  runConfigurationAndWait,
  type RunTarget
} from './run-configuration-control'
import { combineRunConfigurations, useRunConfigurationStore } from './run-configuration-store'
import { configurationCommandKey } from './run-widget-items'

/** The run target a command configuration uses; its key keeps one terminal tab per configuration. */
export function configurationRunTarget(
  configuration: CommandRunConfiguration,
  launch: { command: string; cwd: string },
  worktreeId: string,
  groupId: string | null
): RunTarget {
  const commandKey = configurationCommandKey(configuration.id)
  return {
    worktreeId,
    groupId,
    commandKey,
    cwd: launch.cwd,
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

function planErrorMessage(code: RunPlanErrorCode, reference: string): string {
  switch (code) {
    case 'missing':
      return translate(
        'run.configurations.error.missing',
        "No run configuration named '{{value0}}'",
        {
          value0: reference
        }
      )
    case 'cycle':
      return translate(
        'run.configurations.error.cycle',
        "'{{value0}}' depends on itself through Before launch or a compound",
        { value0: reference }
      )
    case 'step-not-command':
      return translate(
        'run.configurations.error.stepNotCommand',
        "Before launch can only run command configurations; '{{value0}}' is not one",
        { value0: reference }
      )
    case 'multiple-debug':
      return translate(
        'run.configurations.error.multipleDebug',
        "Only one debug session can run at a time; remove '{{value0}}' or run it separately",
        { value0: reference }
      )
  }
}

function resolvedOrToast<T>(result: Resolved<T>, name: string): T | null {
  if (result.ok) {
    return result.value
  }
  toast.error(
    translate(
      'run.configurations.error.variable',
      "'{{value0}}' uses {{value1}}, which Orca cannot resolve here",
      { value0: name, value1: result.variable }
    )
  )
  return null
}

function activeFileIn(worktreeId: string): string | undefined {
  const state = useAppStore.getState()
  const fileId = state.activeFileIdByWorktree[worktreeId]
  const file = fileId ? state.openFiles.find((candidate) => candidate.id === fileId) : undefined
  return file?.mode === 'edit' ? file.filePath : undefined
}

type LaunchScope = {
  worktreeId: string
  groupId: string | null
  context: RunConfigurationVariableContext
  /** Run widget item whose debug session this launch starts. */
  sourceKey?: string
}

/** Each step must exit 0 before the next; a failure or stop ends the whole launch. */
async function runBeforeLaunchSteps(
  steps: readonly CommandRunConfiguration[],
  scope: LaunchScope
): Promise<boolean> {
  for (const step of steps) {
    const launch = resolvedOrToast(resolveCommandLaunch(step, scope.context), step.name)
    if (!launch) {
      return false
    }
    const exit = await runConfigurationAndWait(
      configurationRunTarget(step, launch, scope.worktreeId, scope.groupId)
    )
    // `finished` is a clean end from a shell that reports no exit code.
    if (exit.status !== 'succeeded' && exit.status !== 'finished') {
      toast.error(
        exit.status === 'stopped'
          ? translate(
              'run.configurations.error.stepStopped',
              "Before launch '{{value0}}' was stopped",
              {
                value0: step.name
              }
            )
          : translate(
              'run.configurations.error.stepFailed',
              "Before launch '{{value0}}' did not exit with 0 ({{value1}})",
              { value0: step.name, value1: exit.exitCode ?? '?' }
            )
      )
      return false
    }
  }
  return true
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
      await runConfiguration(
        configurationRunTarget(configuration, launch, scope.worktreeId, scope.groupId)
      )
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
        ...(scope.sourceKey ? { sourceKey: scope.sourceKey } : {}),
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
  sourceKey?: string
}): Promise<void> {
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
    context: { workspaceFolder: worktree.path, file: activeFileIn(options.worktreeId) }
  }
  if (!(await runBeforeLaunchSteps(result.plan.beforeLaunch, scope))) {
    return
  }
  const mainScope = options.sourceKey ? { ...scope, sourceKey: options.sourceKey } : scope
  await Promise.all(result.plan.launches.map((launch) => startLaunch(launch, mainScope)))
}
