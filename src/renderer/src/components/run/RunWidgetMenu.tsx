import React from 'react'
import { Bot, Clock, FileInput, Plus, Settings2, SlidersHorizontal, Zap } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { isTerminalAgentQuickCommand } from '../../../../shared/terminal-quick-commands'
import { runConfigurationIcon } from './run-configuration-icon'
import type { RunWidgetItem } from './run-widget-items'

function itemIcon(item: RunWidgetItem): React.JSX.Element {
  switch (item.kind) {
    case 'recent':
      return <Clock />
    case 'configuration': {
      const Icon = runConfigurationIcon(item.configuration)
      return <Icon />
    }
    case 'quick-command':
      return isTerminalAgentQuickCommand(item.entry.command) ? <Bot /> : <Zap />
  }
}

function Section({
  heading,
  items,
  selectedKey,
  onSelect
}: {
  heading: string
  items: readonly RunWidgetItem[]
  selectedKey: string | null
  onSelect: (item: RunWidgetItem) => void
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  return (
    <>
      <DropdownMenuLabel>{heading}</DropdownMenuLabel>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.key}
          data-current={item.key === selectedKey}
          data-testid="run-widget-item"
          onSelect={() => onSelect(item)}
        >
          {itemIcon(item)}
          <span className="truncate">{item.label}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** One list of everything runnable, then the management actions, as in JetBrains' Run widget. */
export function RunWidgetMenu({
  items,
  selectedKey,
  onSelect,
  onEditConfigurations,
  onImportLaunchJson,
  onAddQuickCommand,
  onManageQuickCommands
}: {
  items: readonly RunWidgetItem[]
  selectedKey: string | null
  onSelect: (item: RunWidgetItem) => void
  onEditConfigurations: () => void
  /** null when the workspace has no `.vscode/launch.json`. */
  onImportLaunchJson: (() => void) | null
  onAddQuickCommand: (() => void) | null
  onManageQuickCommands: () => void
}): React.JSX.Element {
  const sectionProps = { selectedKey, onSelect }
  return (
    <DropdownMenuContent align="end" className="min-w-60">
      <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
        <Section
          {...sectionProps}
          heading={translate('run.widget.recent', 'Recent')}
          items={items.filter((item) => item.kind === 'recent')}
        />
        <Section
          {...sectionProps}
          heading={translate('run.configurations.localHeading', 'This machine')}
          items={items.filter((item) => item.kind === 'configuration' && item.source === 'local')}
        />
        <Section
          {...sectionProps}
          heading={translate('run.configurations.sharedHeading', 'Shared (orca.yaml)')}
          items={items.filter((item) => item.kind === 'configuration' && item.source === 'shared')}
        />
        <Section
          {...sectionProps}
          heading={translate('run.widget.quickCommands', 'Quick commands')}
          items={items.filter((item) => item.kind === 'quick-command')}
        />
      </div>
      {items.length > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem data-testid="run-configurations-edit" onSelect={onEditConfigurations}>
        <Settings2 />
        {translate('run.configurations.edit', 'Edit Configurations…')}
      </DropdownMenuItem>
      {onImportLaunchJson ? (
        <DropdownMenuItem data-testid="run-configurations-import" onSelect={onImportLaunchJson}>
          <FileInput />
          {translate('run.configurations.importLaunchJson', 'Import .vscode/launch.json')}
        </DropdownMenuItem>
      ) : null}
      {onAddQuickCommand ? (
        <DropdownMenuItem data-testid="run-widget-add-quick-command" onSelect={onAddQuickCommand}>
          <Plus />
          {translate('run.widget.addQuickCommand', 'Add Quick Command…')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={onManageQuickCommands}>
        <SlidersHorizontal />
        {translate('run.widget.manageQuickCommands', 'Manage Quick Commands…')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
