import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunConfigurationKind } from '../../../../shared/run-configurations/run-configuration-types'
import type { RunTarget } from './run-target'
import type { RunWidgetItem } from './run-widget-items'

/** What a live run's icon shows: what the run does, or that a debugger drives it. */
export type RunMode = 'run' | 'debug' | 'build' | 'test' | 'publish'

const RUN_CONFIGURATION_KINDS: readonly RunConfigurationKind[] = [
  'build',
  'run',
  'test',
  'publish',
  'other'
]

export function asRunConfigurationKind(value: unknown): RunConfigurationKind | undefined {
  return RUN_CONFIGURATION_KINDS.find((kind) => kind === value)
}

/** The kind a saved configuration's run carries; undefined for plain commands. */
export function runConfigurationKindOf(
  configuration: RunConfigurationDefinition
): RunConfigurationKind | undefined {
  return configuration.type === 'dotnet-publish' ? 'publish' : undefined
}

export function runTargetMode(target: Pick<RunTarget, 'kind'> | null | undefined): RunMode {
  const kind = target?.kind
  return kind === 'build' || kind === 'test' || kind === 'publish' ? kind : 'run'
}

/** The mode of the item's plain run; its debug session is always `debug`. */
export function runWidgetItemMode(item: RunWidgetItem): RunMode {
  switch (item.kind) {
    case 'recent':
    case 'detected':
      return runTargetMode(item.savedTarget ?? item.target)
    case 'configuration':
      return runTargetMode({ kind: runConfigurationKindOf(item.configuration) })
    case 'quick-command':
    case 'current-file':
      return 'run'
  }
}
