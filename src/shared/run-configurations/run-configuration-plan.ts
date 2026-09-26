import {
  findRunConfiguration,
  type CommandRunConfiguration,
  type CompoundMemberWait,
  type DebugRunConfiguration,
  type RunConfigurationDefinition
} from './run-configuration-definition'

export type RunLaunchPlan = {
  /** Commands that must each exit 0, in this order, before anything launches. */
  beforeLaunch: CommandRunConfiguration[]
  /** Started together once the steps succeed, or one by one when `sequential`. */
  launches: (CommandRunConfiguration | DebugRunConfiguration)[]
  sequential: boolean
  /** Sequential only: what to wait for after starting a launch (by launch id). */
  waitAfter: Record<string, CompoundMemberWait>
  /** Every configuration the plan touched, including compounds in between (for trust checks). */
  involvedIds: string[]
}

export type RunPlanErrorCode = 'missing' | 'cycle' | 'step-not-command' | 'multiple-debug'

export type RunPlanResult =
  | { ok: true; plan: RunLaunchPlan }
  | { ok: false; error: { code: RunPlanErrorCode; reference: string } }

class RunPlanError extends Error {
  constructor(
    readonly code: RunPlanErrorCode,
    readonly reference: string
  ) {
    super(`${code}: ${reference}`)
  }
}

function lookup(
  all: readonly RunConfigurationDefinition[],
  reference: string
): RunConfigurationDefinition {
  const found = findRunConfiguration(all, reference)
  if (!found) {
    throw new RunPlanError('missing', reference)
  }
  return found
}

function collectSteps(
  all: readonly RunConfigurationDefinition[],
  owner: CommandRunConfiguration | DebugRunConfiguration,
  steps: CommandRunConfiguration[],
  visiting: Set<string>
): void {
  for (const reference of owner.beforeLaunch ?? []) {
    const step = lookup(all, reference)
    if (step.type !== 'command') {
      throw new RunPlanError('step-not-command', reference)
    }
    if (visiting.has(step.id)) {
      throw new RunPlanError('cycle', step.name)
    }
    if (steps.some((existing) => existing.id === step.id)) {
      continue
    }
    visiting.add(step.id)
    collectSteps(all, step, steps, visiting)
    visiting.delete(step.id)
    steps.push(step)
  }
}

function collectLaunches(
  all: readonly RunConfigurationDefinition[],
  configuration: RunConfigurationDefinition,
  launches: RunLaunchPlan['launches'],
  visiting: Set<string>,
  expanded: Set<string>
): void {
  if (configuration.type !== 'compound') {
    if (!launches.some((existing) => existing.id === configuration.id)) {
      launches.push(configuration)
    }
    return
  }
  if (visiting.has(configuration.id)) {
    throw new RunPlanError('cycle', configuration.name)
  }
  // Why: without this, compounds listing each other repeatedly expand exponentially.
  if (expanded.has(configuration.id)) {
    return
  }
  expanded.add(configuration.id)
  visiting.add(configuration.id)
  for (const reference of configuration.configurations) {
    collectLaunches(all, lookup(all, reference), launches, visiting, expanded)
  }
  visiting.delete(configuration.id)
}

/** Resolves references into what to run first and what to start, or why it cannot run. */
export function planRunConfiguration(
  all: readonly RunConfigurationDefinition[],
  reference: string
): RunPlanResult {
  try {
    const launches: RunLaunchPlan['launches'] = []
    const top = lookup(all, reference)
    const expanded = new Set<string>()
    const sequential = top.type === 'compound' && top.sequential === true
    const waitAfter: Record<string, CompoundMemberWait> = {}
    if (top.type === 'compound' && sequential) {
      // Why per member: a member's wait applies after the last launch it expands into.
      expanded.add(top.id)
      for (const reference of top.configurations) {
        const before = launches.length
        collectLaunches(all, lookup(all, reference), launches, new Set([top.id]), expanded)
        const wait = top.waitAfter?.[reference]
        const last = launches.length > before ? launches.at(-1) : undefined
        if (wait && last) {
          waitAfter[last.id] = wait
        }
      }
    } else {
      collectLaunches(all, top, launches, new Set(), expanded)
    }
    const debugLaunches = launches.filter((launch) => launch.type === 'debug')
    if (debugLaunches.length > 1) {
      // Why: Orca runs one debug session at a time; starting another stops the first.
      throw new RunPlanError('multiple-debug', debugLaunches[1].name)
    }
    const beforeLaunch: CommandRunConfiguration[] = []
    for (const launch of launches) {
      collectSteps(all, launch, beforeLaunch, new Set([launch.id]))
    }
    // A launch that is also another launch's step is already started by the steps.
    const stepIds = new Set(beforeLaunch.map((step) => step.id))
    return {
      ok: true,
      plan: {
        beforeLaunch,
        launches: launches.filter((launch) => !stepIds.has(launch.id)),
        sequential,
        waitAfter,
        involvedIds: [
          ...new Set([top.id, ...expanded, ...stepIds, ...launches.map((launch) => launch.id)])
        ]
      }
    }
  } catch (error) {
    if (error instanceof RunPlanError) {
      return {
        ok: false,
        error: { code: error.code, reference: error.reference }
      }
    }
    throw error
  }
}
