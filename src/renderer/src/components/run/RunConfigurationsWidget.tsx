import React, { useState } from 'react'
import { Bug, ChevronDown, FileInput, ListVideo, Play, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { resolveCommandLaunch } from '../../../../shared/run-configurations/run-configuration-resolve'
import { EditRunConfigurationsDialog } from './EditRunConfigurationsDialog'
import { importWorkspaceLaunchJson } from './launch-json-import-action'
import { RunSessionControls } from './RunSessionControls'
import { runConfigurationIcon } from './run-configuration-icon'
import type { RunTarget } from './run-configuration-control'
import {
  configurationRunTarget,
  launchRunConfiguration,
  loadSharedRunConfigurations
} from './run-configuration-launcher'
import { useRunConfigurationStore, type ListedRunConfiguration } from './run-configuration-store'
import { useWorktreeRunConfigurations } from './use-worktree-run-configurations'

function sessionTarget(
  configuration: RunConfigurationDefinition,
  worktreeId: string,
  worktreePath: string,
  groupId: string | null
): RunTarget | null {
  if (configuration.type !== 'command') {
    return null
  }
  const launch = resolveCommandLaunch(configuration, { workspaceFolder: worktreePath })
  return launch.ok ? configurationRunTarget(configuration, launch.value, worktreeId, groupId) : null
}

function ConfigurationItems({
  entries,
  heading,
  onSelect
}: {
  entries: ListedRunConfiguration[]
  heading: string
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  if (entries.length === 0) {
    return null
  }
  return (
    <>
      <DropdownMenuLabel>{heading}</DropdownMenuLabel>
      {entries.map(({ configuration }) => {
        const Icon = runConfigurationIcon(configuration)
        return (
          <DropdownMenuItem key={configuration.id} onSelect={() => onSelect(configuration.id)}>
            <Icon />
            <span className="truncate">{configuration.name}</span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

/** JetBrains-style configuration picker with Run/Debug for saved and orca.yaml configurations. */
export function RunConfigurationsWidget({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const data = useWorktreeRunConfigurations(worktreeId)
  const groupId = useAppStore((s) => s.activeGroupIdByWorktree[worktreeId] ?? null)
  const select = useRunConfigurationStore((s) => s.select)
  const [editorOpen, setEditorOpen] = useState(false)
  if (!data) {
    return null
  }
  const configuration = data.selected?.configuration ?? null
  const isDebug = configuration?.type === 'debug'
  const launchLabel = configuration
    ? isDebug
      ? translate('run.configurations.debugNamed', "Debug '{{value0}}'", {
          value0: configuration.name
        })
      : translate('run.action.runNamed', "Run '{{value0}}'", { value0: configuration.name })
    : ''
  const LaunchIcon = isDebug ? Bug : Play

  return (
    <div
      data-testid="run-configurations-widget"
      className="my-auto flex shrink-0 items-center gap-0.5"
    >
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            void loadSharedRunConfigurations(worktreeId)
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="run-configurations-trigger"
            aria-label={translate('run.configurations.menu', 'Run configurations')}
            className="flex h-6 max-w-48 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            {configuration ? (
              <span className="truncate">{configuration.name}</span>
            ) : (
              <ListVideo className="size-3.5" />
            )}
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <ConfigurationItems
            entries={data.listed.filter((entry) => entry.source === 'local')}
            heading={translate('run.configurations.localHeading', 'This machine')}
            onSelect={(id) => select(data.repoId, id)}
          />
          <ConfigurationItems
            entries={data.listed.filter((entry) => entry.source === 'shared')}
            heading={translate('run.configurations.sharedHeading', 'Shared (orca.yaml)')}
            onSelect={(id) => select(data.repoId, id)}
          />
          {data.listed.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            data-testid="run-configurations-edit"
            onSelect={() => setEditorOpen(true)}
          >
            <Settings2 />
            {translate('run.configurations.edit', 'Edit Configurations…')}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="run-configurations-import"
            onSelect={() => void importWorkspaceLaunchJson(worktreeId, data.repoId)}
          >
            <FileInput />
            {translate('run.configurations.importLaunchJson', 'Import .vscode/launch.json')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {configuration ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={launchLabel}
              data-testid="run-configurations-launch"
              onClick={() =>
                void launchRunConfiguration({ worktreeId, groupId, reference: configuration.id })
              }
            >
              <LaunchIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {launchLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {configuration?.type === 'command' ? (
        <RunSessionControls
          target={sessionTarget(configuration, worktreeId, data.worktreePath, groupId)}
          testId="run-configurations-session"
          onRerun={() =>
            void launchRunConfiguration({ worktreeId, groupId, reference: configuration.id })
          }
        />
      ) : null}
      {editorOpen ? (
        <EditRunConfigurationsDialog
          worktreeId={worktreeId}
          data={data}
          onOpenChange={setEditorOpen}
        />
      ) : null}
    </div>
  )
}
