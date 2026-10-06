import React from 'react'
import { ChevronLeft, FileInput, Plus, Settings, Settings2, SlidersHorizontal } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { TabBarQuickCommandHostLoadStatus } from '../tab-bar/TabBarQuickCommandHostLoadStatus'
import { isWindowsUserAgent } from '../terminal-pane/pane-helpers'
import { DotnetContainerMenu } from './DotnetContainerMenu'
import { isDetectedRunMenuEmpty, type DetectedRunMenu } from './detected-run-menu'
import { RunWidgetDetectedSection, type DetectedSectionActions } from './RunWidgetDetectedSection'
import { RUN_WIDGET_CONTENT_STYLE } from './run-widget-cascade'
import { RunWidgetMenuRow, type RunWidgetRowContext } from './RunWidgetMenuRow'
import type { RunWidgetItem } from './run-widget-items'

type RowProps = RunWidgetRowContext

function Section({
  heading,
  items,
  selectedKey,
  onSelect,
  rowState,
  rowActions
}: RowProps & {
  /** Omitted for a lone row such as "Current File". */
  heading?: string
  items: readonly RunWidgetItem[]
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  return (
    <>
      {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
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

type ManageSubmenuProps = {
  cascadeLeft: boolean
  worktreeId: string
  groupId: string | null
  onEditConfigurations: () => void
  onImportLaunchJson: (() => void) | null
  onAddQuickCommand: (() => void) | null
  onManageQuickCommands: () => void
}

/** The configuration and quick-command management actions, kept out of the runnable list. */
function ManageSubmenu({
  cascadeLeft,
  worktreeId,
  groupId,
  onEditConfigurations,
  onImportLaunchJson,
  onAddQuickCommand,
  onManageQuickCommands
}: ManageSubmenuProps): React.JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="run-widget-manage" hideChevron={cascadeLeft}>
        <Settings />
        {translate('run.widget.manageMenu', 'Manage')}
        {cascadeLeft ? <ChevronLeft className="ml-auto size-4" /> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent style={RUN_WIDGET_CONTENT_STYLE} className="min-w-56">
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
        {/* Why not on Windows: the container shares folders at the same path, which Windows cannot. */}
        {isWindowsUserAgent() ? null : (
          <DotnetContainerMenu
            worktreeId={worktreeId}
            groupId={groupId}
            cascadeLeft={cascadeLeft}
          />
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
  onManageQuickCommands,
  detected,
  detectedActions,
  cascadeLeft,
  quickCommandHostPending,
  quickCommandHostLoadFailed,
  worktreeId,
  groupId
}: RowProps & {
  items: readonly RunWidgetItem[]
  worktreeId: string
  groupId: string | null
  /** null until the workspace's first scan finishes. */
  detected: DetectedRunMenu | null
  detectedActions: DetectedSectionActions
  /** Submenus open to the left; see runWidgetCascadeDirection. */
  cascadeLeft: boolean
  onEditConfigurations: () => void
  /** null when the workspace has no `.vscode/launch.json`. */
  onImportLaunchJson: (() => void) | null
  onAddQuickCommand: (() => void) | null
  onManageQuickCommands: () => void
  quickCommandHostPending: boolean
  quickCommandHostLoadFailed: boolean
}): React.JSX.Element {
  const sectionProps = { selectedKey, onSelect, rowState, rowActions }
  return (
    <DropdownMenuContent align="end" style={RUN_WIDGET_CONTENT_STYLE} className="min-w-60">
      <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
        <Section {...sectionProps} items={items.filter((item) => item.kind === 'current-file')} />
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
        <RunWidgetDetectedSection
          menu={detected}
          row={sectionProps}
          actions={detectedActions}
          cascadeLeft={cascadeLeft}
        />
        <Section
          {...sectionProps}
          heading={translate('run.widget.quickCommands', 'Quick commands')}
          items={items.filter((item) => item.kind === 'quick-command')}
        />
      </div>
      {quickCommandHostPending ? (
        <TabBarQuickCommandHostLoadStatus failed={quickCommandHostLoadFailed} />
      ) : null}
      {items.length > 0 || !detected || !isDetectedRunMenuEmpty(detected) ? (
        <DropdownMenuSeparator />
      ) : null}
      <ManageSubmenu
        cascadeLeft={cascadeLeft}
        worktreeId={worktreeId}
        groupId={groupId}
        onEditConfigurations={onEditConfigurations}
        onImportLaunchJson={onImportLaunchJson}
        onAddQuickCommand={onAddQuickCommand}
        onManageQuickCommands={onManageQuickCommands}
      />
    </DropdownMenuContent>
  )
}
