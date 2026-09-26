import React, { useState } from 'react'
import { Bug, ChevronDown, ListVideo, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  createTerminalQuickCommandDraft,
  TerminalQuickCommandDialog
} from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useWorktreeQuickCommands } from '@/hooks/use-worktree-quick-commands'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { TerminalQuickCommand } from '../../../../shared/terminal-quick-command-types'
import { useTabBarQuickCommandsShortcut } from '../tab-bar/tab-bar-quick-commands-shortcut'
import { EditRunConfigurationsDialog } from './EditRunConfigurationsDialog'
import { importWorkspaceLaunchJson, useWorkspaceHasLaunchJson } from './launch-json-import-action'
import { RunSessionControls } from './RunSessionControls'
import { RunWidgetMenu } from './RunWidgetMenu'
import { loadSharedRunConfigurations } from './run-configuration-launcher'
import { useRunConfigurationStore } from './run-configuration-store'
import { useRunSessionStore } from './run-session-store'
import {
  canDebugWidgetItem,
  canRunWidgetItem,
  debugWidgetItem,
  runWidgetItem,
  runWidgetSessionTarget,
  type RunWidgetScope
} from './run-widget-actions'
import { runWidgetItems, selectedRunWidgetItem, type RunWidgetItem } from './run-widget-items'
import { useWorktreeRunConfigurations } from './use-worktree-run-configurations'

function runLabel(item: RunWidgetItem): string {
  // Why the quick-command wording: it is the label upstream tests and users know that button by.
  return item.kind === 'quick-command'
    ? translate(
        'auto.components.tab.bar.TabBarQuickCommandsButton.b775303755',
        'Run quick command: {{value0}}',
        { value0: item.label }
      )
    : translate('run.action.runNamed', "Run '{{value0}}'", { value0: item.label })
}

function ActionButton({
  label,
  testId,
  disabled,
  onClick,
  children
}: {
  label: string
  testId: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why a span: a disabled button fires no pointer events, so its tooltip would never show. */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            data-testid={testId}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The tab bar's single JetBrains-style Run widget: pick a configuration, temporary run or quick
 * command, then Run, Debug, Rerun or Stop it.
 */
export function RunWidget({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string | null
}): React.JSX.Element | null {
  const data = useWorktreeRunConfigurations(worktreeId)
  const quick = useWorktreeQuickCommands(worktreeId)
  const detected = useRunSessionStore((s) => s.lastDetectedRunByWorktree[worktreeId])
  const selectedKey = useRunConfigurationStore((s) =>
    data ? s.selectedByRepo[data.repoId] : undefined
  )
  const select = useRunConfigurationStore((s) => s.select)
  const repos = useAppStore((s) => s.repos)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  // Why stored: a draft recreated on every render would reset the dialog while typing.
  const [quickCommandDraft, setQuickCommandDraft] = useState<TerminalQuickCommand | null>(null)
  const onMenuOpenChange = (open: boolean): void => {
    setMenuOpen(open)
    if (open) {
      void loadSharedRunConfigurations(worktreeId)
      quick.refreshRemoteHost()
    }
  }
  useTabBarQuickCommandsShortcut({ menuOpen, onOpenChange: onMenuOpenChange })
  // Why keyed by menuOpen: the file can appear or disappear between openings.
  const hasLaunchJson = useWorkspaceHasLaunchJson(worktreeId, menuOpen)
  if (!data) {
    return null
  }

  const items = runWidgetItems({
    detected,
    configurations: data.listed,
    quickCommands: [...quick.repoCommands, ...quick.globalCommands]
  })
  const selected = selectedRunWidgetItem(items, selectedKey)
  const scope: RunWidgetScope = { worktreeId, groupId, worktreePath: data.worktreePath }
  const quickRepoId = quick.repoId
  const addHostId = quick.hosts.some((host) => host.hostId === quick.executionHostId)
    ? quick.executionHostId
    : (quick.hosts[0]?.hostId ?? quick.executionHostId)
  const debugLabel = selected
    ? translate('run.configurations.debugNamed', "Debug '{{value0}}'", { value0: selected.label })
    : ''

  return (
    <div
      data-testid="run-configurations-widget"
      className="my-auto flex shrink-0 items-center gap-0.5"
    >
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="run-configurations-trigger"
            aria-label={translate('run.configurations.menu', 'Run configurations')}
            className="flex h-6 max-w-52 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            {selected ? (
              <span className="truncate">{selected.label}</span>
            ) : (
              <>
                <ListVideo className="size-3.5 shrink-0" />
                <span className="truncate">
                  {translate('run.addConfiguration', 'Add Configuration…')}
                </span>
              </>
            )}
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <RunWidgetMenu
          items={items}
          selectedKey={selected?.key ?? null}
          onSelect={(item) => select(data.repoId, item.key)}
          onEditConfigurations={() => setEditorOpen(true)}
          onImportLaunchJson={
            hasLaunchJson ? () => void importWorkspaceLaunchJson(worktreeId, data.repoId) : null
          }
          onAddQuickCommand={
            quickRepoId
              ? () =>
                  setQuickCommandDraft(
                    createTerminalQuickCommandDraft({ type: 'repo', repoId: quickRepoId })
                  )
              : null
          }
          onManageQuickCommands={() => {
            const state = useAppStore.getState()
            state.openSettingsTarget({ pane: 'quick-commands', repoId: null })
            state.openSettingsPage()
          }}
        />
      </DropdownMenu>
      {selected ? (
        <>
          <ActionButton
            label={runLabel(selected)}
            testId="run-configurations-launch"
            disabled={!canRunWidgetItem(selected)}
            onClick={() => void runWidgetItem(selected, scope)}
          >
            <Play />
          </ActionButton>
          <ActionButton
            label={debugLabel}
            testId="run-configurations-debug"
            disabled={!canDebugWidgetItem(selected)}
            onClick={() => void debugWidgetItem(selected, scope)}
          >
            <Bug />
          </ActionButton>
          <RunSessionControls
            target={runWidgetSessionTarget(selected, scope)}
            testId="run-configurations-session"
            // Why: configurations rerun through the launcher so trust and Before launch apply again.
            onRerun={
              selected.kind === 'configuration'
                ? () => void runWidgetItem(selected, scope)
                : undefined
            }
          />
        </>
      ) : null}
      {editorOpen ? (
        <EditRunConfigurationsDialog
          worktreeId={worktreeId}
          data={data}
          onOpenChange={setEditorOpen}
        />
      ) : null}
      {quickCommandDraft ? (
        <TerminalQuickCommandDialog
          open
          mode="add"
          command={quickCommandDraft}
          repos={
            addHostId.startsWith('runtime:')
              ? repos.filter((repo) => getRepoExecutionHostId(repo) === addHostId)
              : repos
          }
          onOpenChange={(open) => !open && setQuickCommandDraft(null)}
          onSave={(command) =>
            void useAppStore.getState().upsertTerminalQuickCommand(addHostId, command)
          }
        />
      ) : null}
    </div>
  )
}
