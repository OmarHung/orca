import React, { useEffect, useState } from 'react'
import { ChevronDown, ListVideo } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { RunWidgetActions } from './RunWidgetActions'
import { RunWidgetMenu } from './RunWidgetMenu'
import { loadSharedRunConfigurations } from './run-configuration-launcher'
import { useRunConfigurationStore, type ListedRunConfiguration } from './run-configuration-store'
import { useRecentRunStore } from './recent-run-store'
import { useRunSessionStore } from './run-session-store'
import type { RunTarget } from './run-configuration-control'
import type { RunWidgetScope } from './run-widget-actions'
import { runWidgetItemForRun, runWidgetItems, selectedRunWidgetItem } from './run-widget-items'
import { useWorktreeRunConfigurations } from './use-worktree-run-configurations'
import { useCompoundQuickCommand } from './use-compound-quick-command'

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
  const activeRunKey = useRunSessionStore((s) =>
    activeTerminalTabId
      ? Object.values(s.sessionsByKey).find(
          (session) => session.worktreeId === worktreeId && session.tabId === activeTerminalTabId
        )?.commandKey
      : undefined
  )
  // Why keyed by menuOpen: the file can appear or disappear between openings.
  const hasLaunchJson = useWorkspaceHasLaunchJson(worktreeId, menuOpen)
  const items = runWidgetItems({
    recent,
    configurations: data?.listed ?? NO_CONFIGURATIONS,
    quickCommands: [...quick.repoCommands, ...quick.globalCommands]
  })
  const activeRunItemKey = activeRunKey ? runWidgetItemForRun(items, activeRunKey)?.key : undefined
  const repoId = data?.repoId
  // Why on tab change only: switching to a run's terminal shows that run's controls, while a
  // later pick from the menu still wins until the next switch.
  useEffect(() => {
    if (repoId !== undefined && activeRunItemKey) {
      select(repoId, activeRunItemKey)
    }
  }, [activeTerminalTabId, activeRunItemKey, repoId, select])
  if (!data) {
    return null
  }

  const selected = selectedRunWidgetItem(items, selectedKey)
  const scope: RunWidgetScope = {
    worktreeId,
    groupId,
    worktreePath: data.worktreePath
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
          onSelect={(item) => select(data.repoId, item.key)}
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
      {selected ? <RunWidgetActions item={selected} scope={scope} /> : null}
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
