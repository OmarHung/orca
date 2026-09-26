import type { HostedTerminalQuickCommand } from '@/hooks/use-terminal-quick-command-hosts'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunTarget } from './run-configuration-control'
import type { ListedRunConfiguration, RunConfigurationSource } from './run-configuration-store'

/** Selection saved before recent runs became a list; it now means the newest one. */
const LEGACY_DETECTED_KEY = 'detected'

/** Everything the tab-bar Run widget can select, like JetBrains' configuration list. */
export type RunWidgetItem =
  | { kind: 'recent'; key: string; label: string; target: RunTarget }
  | {
      kind: 'configuration'
      key: string
      label: string
      source: RunConfigurationSource
      configuration: RunConfigurationDefinition
    }
  | { kind: 'quick-command'; key: string; label: string; entry: HostedTerminalQuickCommand }

export function recentItemKey(commandKey: string): string {
  return `recent:${commandKey}`
}

/** The terminal run key a saved command configuration uses (one tab per configuration). */
export function configurationCommandKey(id: string): string {
  return `config:${id}`
}

export function configurationItemKey(id: string): string {
  return `config:${id}`
}

export function quickCommandItemKey(entryKey: string): string {
  return `quick:${entryKey}`
}

export function runWidgetItems(options: {
  recent: readonly RunTarget[]
  configurations: readonly ListedRunConfiguration[]
  quickCommands: readonly HostedTerminalQuickCommand[]
}): RunWidgetItem[] {
  return [
    ...options.recent.map((target) => ({
      kind: 'recent' as const,
      key: recentItemKey(target.commandKey),
      label: target.command.label,
      target
    })),
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
      : selectedKey === LEGACY_DETECTED_KEY
        ? items.find((item) => item.kind === 'recent')
        : (items.find((item) => item.key === selectedKey) ??
          items.find((item) => item.key === configurationItemKey(selectedKey)))
  return match ?? items[0] ?? null
}

/** The run key of the terminal an item runs in; null for items that never own a run tab. */
function runCommandKey(item: RunWidgetItem): string | null {
  switch (item.kind) {
    case 'recent':
      return item.target.commandKey
    case 'configuration':
      return item.configuration.type === 'command'
        ? configurationCommandKey(item.configuration.id)
        : null
    case 'quick-command':
      return item.entry.key
  }
}

/** The item whose run owns a terminal, so switching to that terminal can select it. */
export function runWidgetItemForRun(
  items: readonly RunWidgetItem[],
  commandKey: string
): RunWidgetItem | null {
  return items.find((item) => runCommandKey(item) === commandKey) ?? null
}
