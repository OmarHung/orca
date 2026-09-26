import React, { useEffect, useState } from 'react'
import { Bug, FlaskConical, Hammer, ListTree, Play, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
} from './run-configuration-control'
import {
  detectProjectRunConfigurations,
  mayContainRunConfigurations
} from './project-run-detection'

const KIND_ICONS: Record<RunConfigurationKind, LucideIcon> = {
  build: Hammer,
  run: Play,
  test: FlaskConical,
  publish: Upload,
  other: Play
}

/** Build, Run, Test and Publish shown directly; everything else lives in the submenu. */
const PRIMARY_KINDS: RunConfigurationKind[] = ['build', 'run', 'test', 'publish']

function primaryLabel(configuration: DetectedRunConfiguration): string {
  const label = detectedConfigurationLabel(configuration)
  switch (configuration.kind) {
    case 'build':
      return translate('run.menu.build', "Build '{{value0}}'", {
        value0: configuration.projectName
      })
    case 'test':
      return translate('run.menu.test', "Test '{{value0}}'", { value0: configuration.projectName })
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
  const Icon = KIND_ICONS[configuration.kind]
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
    if (configuration.kind === 'publish') {
      const confirmed = await confirm({
        title: translate('run.publishConfirm.title', "Publish '{{value0}}'?", {
          value0: configuration.projectName
        }),
        description: translate('run.publishConfirm.description', 'This runs: {{value0}}', {
          value0: configuration.command
        }),
        confirmLabel: translate('run.publishConfirm.confirm', 'Publish')
      })
      if (!confirmed) {
        return
      }
    }
    await runDetectedConfiguration(configuration, worktreeId, groupId)
  }
  const debug = (configuration: DetectedRunConfiguration): void => {
    void debugDetectedConfiguration(configuration, worktreeId, groupId)
  }
  const primaryDebug = configurations.find((configuration) => configuration.debug)
  const primary = PRIMARY_KINDS.flatMap((kind) => {
    const first = configurations.find((configuration) => configuration.kind === kind)
    return first ? [first] : []
  })
  return (
    <>
      {primary.map((configuration) => (
        <RunConfigurationMenuItem
          key={configuration.id}
          configuration={configuration}
          label={primaryLabel(configuration)}
          onRun={(target) => void run(target)}
        />
      ))}
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
      {configurations.length > primary.length ||
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
