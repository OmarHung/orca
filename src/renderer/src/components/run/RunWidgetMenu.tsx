import React from 'react'
import { FileInput, Plus, Settings2, SlidersHorizontal } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import {
  RunWidgetMenuRow,
  type RunWidgetRowActions,
  type RunWidgetRowState
} from './RunWidgetMenuRow'
import type { RunWidgetItem } from './run-widget-items'

type RowProps = {
  selectedKey: string | null
  onSelect: (item: RunWidgetItem) => void
  rowState: (item: RunWidgetItem) => RunWidgetRowState
  rowActions: RunWidgetRowActions
}

function Section({
  heading,
  items,
  selectedKey,
  onSelect,
  rowState,
  rowActions
}: RowProps & {
  heading: string
  items: readonly RunWidgetItem[]
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  return (
    <>
      <DropdownMenuLabel>{heading}</DropdownMenuLabel>
      {items.map((item) => (
        <RunWidgetMenuRow
          key={item.key}
          item={item}
          current={item.key === selectedKey}
          state={rowState(item)}
          actions={rowActions}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

/** One list of everything runnable, then the management actions, as in JetBrains' Run widget. */
export function RunWidgetMenu({
  items,
  selectedKey,
  onSelect,
  rowState,
  rowActions,
  onEditConfigurations,
  onImportLaunchJson,
  onAddQuickCommand,
  onManageQuickCommands
}: RowProps & {
  items: readonly RunWidgetItem[]
  onEditConfigurations: () => void
  /** null when the workspace has no `.vscode/launch.json`. */
  onImportLaunchJson: (() => void) | null
  onAddQuickCommand: (() => void) | null
  onManageQuickCommands: () => void
}): React.JSX.Element {
  const sectionProps = { selectedKey, onSelect, rowState, rowActions }
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
