import React from 'react'
import { Plus, Upload } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'

/** A Dockerfile's export stages that no saved export of the project builds yet. */
export function unsavedExportStages(
  from: DetectedRunConfiguration | null,
  saved: readonly RunConfigurationDefinition[]
): string[] {
  const exported = new Set(
    saved.flatMap((configuration) =>
      configuration.type === 'docker-export' ? [configuration.target] : []
    )
  )
  return from?.dockerExport?.stages.filter((stage) => !exported.has(stage)) ?? []
}

/**
 * The end of a project's Publish submenu: a new .NET folder publish, or a Dockerfile's export stages
 * not saved yet and a new export, each opening its settings dialog.
 */
export function DetectedPublishActions({
  from,
  saved,
  onNewPublish,
  onNewDockerExport
}: {
  /** The project's run that names its project file, or carries its Docker export stages. */
  from: DetectedRunConfiguration
  saved: readonly RunConfigurationDefinition[]
  onNewPublish: (run: DetectedRunConfiguration) => void
  onNewDockerExport: (run: DetectedRunConfiguration, stage?: string) => void
}): React.JSX.Element | null {
  if (from.ecosystem === 'dotnet') {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="run-widget-new-publish" onSelect={() => onNewPublish(from)}>
          <Plus />
          {translate('run.widget.newPublishToFolder', 'New Publish to Folder…')}
        </DropdownMenuItem>
      </>
    )
  }
  if (!from.dockerExport) {
    return null
  }
  return (
    <>
      <DropdownMenuSeparator />
      {unsavedExportStages(from, saved).map((stage) => (
        <DropdownMenuItem
          key={stage}
          data-testid="run-widget-export-stage"
          onSelect={() => onNewDockerExport(from, stage)}
        >
          <Upload />
          <span className="min-w-0 flex-1 truncate">{`${stage}…`}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        data-testid="run-widget-new-export"
        onSelect={() => onNewDockerExport(from)}
      >
        <Plus />
        {translate('run.widget.newExportToFolder', 'New Export to Folder…')}
      </DropdownMenuItem>
    </>
  )
}
