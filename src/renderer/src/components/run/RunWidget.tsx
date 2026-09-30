import React, { useState } from 'react'
import { ChevronDown, ListVideo } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  createTerminalQuickCommandDraft,
  TerminalQuickCommandDialog
} from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useWorktreeQuickCommands } from '@/hooks/use-worktree-quick-commands'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { TerminalQuickCommand } from '../../../../shared/terminal-quick-command-types'
import { useTabBarQuickCommandsShortcut } from '../tab-bar/tab-bar-quick-commands-shortcut'
import { EditRunConfigurationsDialog } from './EditRunConfigurationsDialog'
import { detectedRunWidgetItem, selectDetectedRun } from './detected-run-configuration'
import { detectedRunHideKey, detectedRunMenu } from './detected-run-menu'
import { useDetectedRunVisibilityStore } from './detected-run-visibility-store'
import { importWorkspaceLaunchJson, useWorkspaceHasLaunchJson } from './launch-json-import-action'
import { RunStopControl } from './RunStopControl'
import { RunWidgetActions } from './RunWidgetActions'
import { RunWidgetMenu } from './RunWidgetMenu'
import type { RunWidgetRowActions } from './RunWidgetMenuRow'
import { loadSharedRunConfigurations } from './run-configuration-launcher'
import { useRunConfigurationStore, type ListedRunConfiguration } from './run-configuration-store'
import { useRecentRunStore } from './recent-run-store'
import { gentlestStopStage, runStopStage } from './run-session-store'
import type { RunTarget } from './run-configuration-control'
import {
  debugWidgetItem,
  runWidgetItem,
  stopRunWidgetItem,
  type RunWidgetScope
} from './run-widget-actions'
import {
  footprintRuns,
  isFootprintDebugging,
  runWidgetFootprint,
  type RunWidgetFootprint
} from './run-widget-activity'
import { runWidgetItems, selectedRunWidgetItem, type RunWidgetItem } from './run-widget-items'
import { useWorktreeRunConfigurations } from './use-worktree-run-configurations'
import { useCompoundQuickCommand } from './use-compound-quick-command'
import { useFollowActiveRunTerminal } from './use-follow-active-run-terminal'
import { useRunWidgetActivity } from './use-run-widget-activity'
import { useRunWidgetDetectedRuns } from './use-run-widget-detected-runs'

/** The Run widget's Add Quick Command dialog, which can also save a compound run configuration. */
function RunWidgetQuickCommandDialog({
  worktreeId,
  ...props
}: Omit<React.ComponentProps<typeof TerminalQuickCommandDialog>, 'compound' | 'open' | 'mode'> & {
  worktreeId: string
}): React.JSX.Element {
  const compound = useCompoundQuickCommand(worktreeId)
  return <TerminalQuickCommandDialog open mode="add" compound={compound} {...props} />
}

const NO_RECENT_RUNS: RunTarget[] = []
const NO_CONFIGURATIONS: ListedRunConfiguration[] = []
const NO_HIDDEN: string[] = []

/**
 * The tab bar's single JetBrains-style Run widget: pick a configuration, temporary run or quick
 * command, then Run, Debug, Rerun or Stop it.
 */
export function RunWidget({
  worktreeId,
  groupId,
  activeTerminalTabId
}: {
  worktreeId: string
  groupId: string | null
  /** The group's active terminal tab; when it belongs to a run, that run is selected. */
  activeTerminalTabId: string | null
}): React.JSX.Element | null {
  const data = useWorktreeRunConfigurations(worktreeId)
  const quick = useWorktreeQuickCommands(worktreeId)
  const recent = useRecentRunStore((s) => s.recentByWorktree[worktreeId] ?? NO_RECENT_RUNS)
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
  const detectedRuns = useRunWidgetDetectedRuns(worktreeId, menuOpen)
  const hiddenDetected = useDetectedRunVisibilityStore((s) =>
    data ? (s.hiddenByRepo[data.repoId] ?? NO_HIDDEN) : NO_HIDDEN
  )
  const items = runWidgetItems({
    recent,
    configurations: data?.listed ?? NO_CONFIGURATIONS,
    quickCommands: [...quick.repoCommands, ...quick.globalCommands]
  })
  const activity = useRunWidgetActivity(worktreeId)
  const confirm = useConfirmationDialog()
  const configurations = (data?.listed ?? NO_CONFIGURATIONS).map((entry) => entry.configuration)
  const footprints = new Map(
    items.map((item) => [item.key, runWidgetFootprint(item, configurations)] as const)
  )
  const footprintOf = (item: RunWidgetItem): RunWidgetFootprint =>
    footprints.get(item.key) ?? runWidgetFootprint(item, configurations)
  const selected = selectedRunWidgetItem(items, selectedKey)
  useFollowActiveRunTerminal({
    worktreeId,
    repoId: data?.repoId,
    activeTerminalTabId,
    items,
    selectedFootprint: selected ? footprintOf(selected) : null
  })
  if (!data) {
    return null
  }

  const scope: RunWidgetScope = {
    worktreeId,
    groupId,
    worktreePath: data.worktreePath
  }
  // Why Run and Debug close the menu: they open a terminal or a dialog. Rerun and Stop keep it
  // open so several runs can be managed in one go.
  const rowActions: RunWidgetRowActions = {
    run: (item) => {
      setMenuOpen(false)
      void runWidgetItem(item, scope, confirm)
    },
    debug: (item) => {
      setMenuOpen(false)
      void debugWidgetItem(item, scope, confirm)
    },
    rerun: (item) => void runWidgetItem(item, scope, confirm),
    stop: (item) => stopRunWidgetItem(item, footprintOf(item), activity, worktreeId)
  }
  const quickRepoId = quick.repoId
  const addHostId = quick.hosts.some((host) => host.hostId === quick.executionHostId)
    ? quick.executionHostId
    : (quick.hosts[0]?.hostId ?? quick.executionHostId)

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
          onSelect={(item) =>
            item.kind === 'detected'
              ? selectDetectedRun(item.target)
              : select(data.repoId, item.key)
          }
          detected={
            detectedRuns
              ? detectedRunMenu(detectedRuns, data.worktreePath, new Set(hiddenDetected))
              : null
          }
          detectedActions={{
            toItem: (run) => detectedRunWidgetItem(run, worktreeId, groupId),
            hideKeyOf: (run) => detectedRunHideKey(run, data.worktreePath),
            onHide: (key) => useDetectedRunVisibilityStore.getState().hide(data.repoId, key),
            onShow: (keys) => useDetectedRunVisibilityStore.getState().show(data.repoId, keys)
          }}
          rowState={(item) => {
            const runs = footprintRuns(footprintOf(item), activity)
            return {
              running: runs.length > 0,
              debugging: isFootprintDebugging(footprintOf(item), activity),
              stopStage: gentlestStopStage(runs.map(runStopStage))
            }
          }}
          rowActions={rowActions}
          onEditConfigurations={() => setEditorOpen(true)}
          onImportLaunchJson={
            hasLaunchJson ? () => void importWorkspaceLaunchJson(worktreeId, data.repoId) : null
          }
          onAddQuickCommand={
            quickRepoId
              ? () =>
                  setQuickCommandDraft(
                    createTerminalQuickCommandDraft({
                      type: 'repo',
                      repoId: quickRepoId
                    })
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
        <RunWidgetActions
          item={selected}
          scope={scope}
          footprint={footprintOf(selected)}
          activity={activity}
        />
      ) : null}
      <RunStopControl worktreeId={worktreeId} activity={activity} />
      {editorOpen ? (
        <EditRunConfigurationsDialog
          worktreeId={worktreeId}
          data={data}
          onOpenChange={setEditorOpen}
        />
      ) : null}
      {quickCommandDraft ? (
        <RunWidgetQuickCommandDialog
          worktreeId={worktreeId}
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
