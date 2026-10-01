import React, { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getTabEntryAllowAbsolutePaths } from '../tab-bar/tab-create-entry-local-path'
import { DockerExportFields } from './DockerExportFields'
import {
  useDockerExportDialogStore,
  type DockerExportDialogRequest
} from './docker-export-dialog-store'
import { SavedRunConfigurationDialog } from './SavedRunConfigurationDialog'

function DockerExportDialog({
  request,
  onClose
}: {
  request: DockerExportDialogRequest
  onClose: () => void
}): React.JSX.Element {
  const [browseRoot] = useState(() =>
    getTabEntryAllowAbsolutePaths(useAppStore.getState(), request.worktreeId)
      ? request.worktreePath
      : null
  )
  return (
    <SavedRunConfigurationDialog
      scope={request}
      initial={request.configuration}
      testIdPrefix="docker-export"
      title={translate('run.dockerExportDialog.title', 'Export to folder')}
      description={translate(
        'run.dockerExportDialog.description',
        'Builds one stage of the Dockerfile and copies its files to a folder. Saved as a run configuration for this repository, so the Run widget can export again with the same settings.'
      )}
      runLabel={translate('run.dockerExportDialog.export', 'Export')}
      onClose={onClose}
      renderFields={(draft, update) => (
        <DockerExportFields
          configuration={draft}
          disabled={false}
          browseRoot={browseRoot}
          worktreePath={request.worktreePath}
          stages={request.stages}
          onChange={update}
        />
      )}
    />
  )
}

/** App-level host: the menu that asks for it closes before the dialog opens. */
export function DockerExportDialogHost(): React.JSX.Element | null {
  const request = useDockerExportDialogStore((s) => s.request)
  const close = useDockerExportDialogStore((s) => s.close)
  // Why key: each request starts a fresh draft.
  return request ? (
    <DockerExportDialog key={request.configuration.id} request={request} onClose={close} />
  ) : null
}
