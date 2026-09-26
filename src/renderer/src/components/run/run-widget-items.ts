import type { HostedTerminalQuickCommand } from '@/hooks/use-terminal-quick-command-hosts'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunTarget } from './run-configuration-control'
import type { ListedRunConfiguration, RunConfigurationSource } from './run-configuration-store'

export const DETECTED_RUN_KEY = 'detected'

/** Everything the tab-bar Run widget can select, like JetBrains' configuration list. */
export type RunWidgetItem =
  | { kind: 'detected'; key: string; label: string; target: RunTarget }
  | {
      kind: 'configuration'
      key: string
      label: string
      source: RunConfigurationSource
      configuration: RunConfigurationDefinition
    }
  | { kind: 'quick-command'; key: string; label: string; entry: HostedTerminalQuickCommand }

export function configurationItemKey(id: string): string {
  return `config:${id}`
}

export function quickCommandItemKey(entryKey: string): string {
  return `quick:${entryKey}`
}

export function runWidgetItems(options: {
  detected: RunTarget | undefined
  configurations: readonly ListedRunConfiguration[]
  quickCommands: readonly HostedTerminalQuickCommand[]
}): RunWidgetItem[] {
  return [
    ...(options.detected
      ? [
          {
            kind: 'detected' as const,
            key: DETECTED_RUN_KEY,
            label: options.detected.command.label,
            target: options.detected
          }
        ]
      : []),
    ...options.configurations.map(({ configuration, source }) => ({
      kind: 'configuration' as const,
      key: configurationItemKey(configuration.id),
      label: configuration.name,
      source,
      configuration
    })),
    ...options.quickCommands.map((entry) => ({
      kind: 'quick-command' as const,
      key: quickCommandItemKey(entry.key),
      label: entry.command.label,
      entry
    }))
  ]
}

/** The stored selection, or the first item. A bare id is a selection saved before quick commands joined. */
export function selectedRunWidgetItem(
  items: readonly RunWidgetItem[],
  selectedKey: string | undefined
): RunWidgetItem | null {
  const match =
    selectedKey === undefined
      ? undefined
      : (items.find((item) => item.key === selectedKey) ??
        items.find((item) => item.key === configurationItemKey(selectedKey)))
  return match ?? items[0] ?? null
}
