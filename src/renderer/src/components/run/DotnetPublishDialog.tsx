import React, { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getTabEntryAllowAbsolutePaths } from '../tab-bar/tab-create-entry-local-path'
import { DotnetPublishFields } from './DotnetPublishFields'
import {
  useDotnetPublishDialogStore,
  type DotnetPublishDialogRequest
} from './dotnet-publish-dialog-store'
import { SavedRunConfigurationDialog } from './SavedRunConfigurationDialog'

function DotnetPublishDialog({
  request,
  onClose
}: {
  request: DotnetPublishDialogRequest
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
      testIdPrefix="dotnet-publish"
      title={translate('run.publishDialog.title', 'Publish to folder')}
      description={translate(
        'run.publishDialog.description',
        'Saved as a run configuration for this repository, so the Run widget can publish again with the same settings.'
      )}
      runLabel={translate('run.publishConfirm.confirm', 'Publish')}
      onClose={onClose}
      renderFields={(draft, update) => (
        <DotnetPublishFields
          configuration={draft}
          disabled={false}
          browseRoot={browseRoot}
          onChange={update}
        />
      )}
    />
  )
}

/** App-level host: the file-tree menu that asks for it closes before the dialog opens. */
export function DotnetPublishDialogHost(): React.JSX.Element | null {
  const request = useDotnetPublishDialogStore((s) => s.request)
  const close = useDotnetPublishDialogStore((s) => s.close)
  // Why key: each request starts a fresh draft.
  return request ? (
    <DotnetPublishDialog key={request.configuration.id} request={request} onClose={close} />
  ) : null
}
