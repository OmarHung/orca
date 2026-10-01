import React, { useEffect, useState } from 'react'
import { Bug, ListTree, Upload } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type {
  DetectedRunConfiguration,
  RunConfigurationKind
} from '../../../../shared/run-configurations/run-configuration-types'
import {
  debugDetectedConfiguration,
  detectedConfigurationLabel,
  runDetectedConfiguration
} from './detected-run-configuration'
import {
  detectProjectRunConfigurations,
  mayContainRunConfigurations
} from './project-run-detection'
import { openDockerExportDialog } from './docker-export-dialog-store'
import { openDotnetPublishDialog } from './dotnet-publish-dialog-store'
import { RUN_KIND_ICONS } from './run-configuration-icon'

/** Build, Run, Test and Publish shown directly; everything else lives in the submenu. */
const PRIMARY_KINDS: RunConfigurationKind[] = ['build', 'run', 'test', 'publish']

/** .NET's primary Publish opens the folder publish settings instead of running a profile. */
function opensPublishDialog(configuration: DetectedRunConfiguration): boolean {
  return configuration.kind === 'publish' && configuration.ecosystem === 'dotnet'
}

function primaryLabel(configuration: DetectedRunConfiguration): string {
  const label = detectedConfigurationLabel(configuration)
  switch (configuration.kind) {
    case 'build':
      return translate('run.menu.build', "Build '{{value0}}'", {
        value0: configuration.projectName
      })
    case 'test':
      return translate('run.menu.test', "Test '{{value0}}'", {
        value0: configuration.projectName
      })
    case 'publish':
      return translate('run.menu.publish', "Publish '{{value0}}'…", {
        value0: configuration.projectName
      })
    case 'run':
    case 'other':
      return translate('run.menu.run', "Run '{{value0}}'", { value0: label })
  }
}

function RunConfigurationMenuItem({
  configuration,
  label,
  onRun
}: {
  configuration: DetectedRunConfiguration
  label: string
  onRun: (configuration: DetectedRunConfiguration) => void
}): React.JSX.Element {
  const Icon = RUN_KIND_ICONS[configuration.kind]
  return (
    <ContextMenuItem onSelect={() => onRun(configuration)}>
      <Icon />
      <span className="truncate">{label}</span>
    </ContextMenuItem>
  )
}

/**
 * JetBrains-style Build/Run/Test/Publish entries for a project folder or project file in the
 * file tree, detected from package.json or *.csproj when the menu opens.
 */
export function ProjectRunContextMenuItems({
  path,
  name,
  isDirectory
}: {
  path: string
  name: string
  isDirectory: boolean
}): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const groupId = useAppStore((s) =>
    worktreeId ? (s.activeGroupIdByWorktree[worktreeId] ?? null) : null
  )
  const confirm = useConfirmationDialog()
  const [configurations, setConfigurations] = useState<DetectedRunConfiguration[]>([])
  const probe = worktreeId !== null && mayContainRunConfigurations(name, isDirectory)

  useEffect(() => {
    if (!probe || !worktreeId) {
      return
    }
    let cancelled = false
    void detectProjectRunConfigurations(worktreeId, path, isDirectory).then((found) => {
      if (!cancelled) {
        setConfigurations(found)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isDirectory, path, probe, worktreeId])

  if (!worktreeId || configurations.length === 0) {
    return null
  }
  const run = async (configuration: DetectedRunConfiguration): Promise<void> => {
    await runDetectedConfiguration(configuration, worktreeId, groupId, confirm)
  }
  const runPrimary = (configuration: DetectedRunConfiguration): void => {
    if (opensPublishDialog(configuration)) {
      void openDotnetPublishDialog(configuration, worktreeId, groupId)
      return
    }
    void run(configuration)
  }
  const debug = (configuration: DetectedRunConfiguration): void => {
    void debugDetectedConfiguration(configuration, worktreeId, groupId, confirm)
  }
  const primaryDebug = configurations.find((configuration) => configuration.debug)
  const exportFrom = configurations.find((configuration) => configuration.dockerExport)
  const primary = PRIMARY_KINDS.flatMap((kind) => {
    const first = configurations.find((configuration) => configuration.kind === kind)
    return first ? [first] : []
  })
  // Why: a .NET publish profile is only reachable from More Run/Debug.
  const runDirectly = primary.filter((configuration) => !opensPublishDialog(configuration))
  return (
    <>
      {primary.map((configuration) => (
        <RunConfigurationMenuItem
          key={configuration.id}
          configuration={configuration}
          label={primaryLabel(configuration)}
          onRun={runPrimary}
        />
      ))}
      {exportFrom ? (
        <ContextMenuItem onSelect={() => openDockerExportDialog(exportFrom, worktreeId, groupId)}>
          <Upload />
          <span className="truncate">
            {translate('run.menu.exportToFolder', "Export '{{value0}}' to Folder…", {
              value0: exportFrom.projectName
            })}
          </span>
        </ContextMenuItem>
      ) : null}
      {primaryDebug ? (
        <ContextMenuItem onSelect={() => debug(primaryDebug)}>
          <Bug />
          <span className="truncate">
            {translate('debug.action.debugFile', "Debug '{{value0}}'", {
              value0: detectedConfigurationLabel(primaryDebug)
            })}
          </span>
        </ContextMenuItem>
      ) : null}
      {configurations.length > runDirectly.length ||
      configurations.filter((configuration) => configuration.debug).length > 1 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ListTree />
            {translate('run.menu.more', 'More Run/Debug')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-72">
            <div className="scrollbar-sleek max-h-96 overflow-y-auto">
              {[...new Set(configurations.map((configuration) => configuration.projectName))].map(
                (projectName) => (
                  <React.Fragment key={projectName}>
                    <ContextMenuLabel>{projectName}</ContextMenuLabel>
                    {configurations
                      .filter((configuration) => configuration.projectName === projectName)
                      .flatMap((configuration) => [
                        <RunConfigurationMenuItem
                          key={configuration.id}
                          configuration={configuration}
                          label={configuration.name}
                          onRun={(target) => void run(target)}
                        />,
                        configuration.debug ? (
                          <ContextMenuItem
                            key={`${configuration.id}:debug`}
                            onSelect={() => debug(configuration)}
                          >
                            <Bug />
                            <span className="truncate">
                              {translate('run.menu.debugNamed', "Debug '{{value0}}'", {
                                value0: configuration.name
                              })}
                            </span>
                          </ContextMenuItem>
                        ) : null
                      ])}
                  </React.Fragment>
                )
              )}
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuSeparator />
    </>
  )
}
