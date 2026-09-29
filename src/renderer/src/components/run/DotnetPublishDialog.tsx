import React, { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { DotnetPublishRunConfiguration } from '../../../../shared/run-configurations/dotnet-publish-configuration'
import { normalizeRunConfigurationDefinitions } from '../../../../shared/run-configurations/run-configuration-definition'
import { getTabEntryAllowAbsolutePaths } from '../tab-bar/tab-create-entry-local-path'
import { DotnetPublishFields } from './DotnetPublishFields'
import {
  useDotnetPublishDialogStore,
  type DotnetPublishDialogRequest
} from './dotnet-publish-dialog-store'
import { launchRunConfiguration } from './run-configuration-launcher'
import { useRunConfigurationStore } from './run-configuration-store'
import { FormField } from './RunConfigurationFormField'
import { configurationItemKey } from './run-widget-items'

/** Saves the folder publish for the repository (replacing an earlier save) and selects it. */
function saveConfiguration(
  request: DotnetPublishDialogRequest,
  draft: DotnetPublishRunConfiguration
): string | null {
  const { configurations, problems } = normalizeRunConfigurationDefinitions([draft])
  const [configuration] = configurations
  if (!configuration) {
    return problems[0]?.message ?? null
  }
  const store = useRunConfigurationStore.getState()
  const local = store.localByRepo[request.repoId] ?? []
  const exists = local.some((entry) => entry.id === configuration.id)
  store.setLocal(
    request.repoId,
    exists
      ? local.map((entry) => (entry.id === configuration.id ? configuration : entry))
      : [...local, configuration]
  )
  store.select(request.repoId, configurationItemKey(configuration.id))
  return null
}

function DotnetPublishDialog({
  request,
  onClose
}: {
  request: DotnetPublishDialogRequest
  onClose: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(request.configuration)
  const [error, setError] = useState<string | null>(null)
  const [browseRoot] = useState(() =>
    getTabEntryAllowAbsolutePaths(useAppStore.getState(), request.worktreeId)
      ? request.worktreePath
      : null
  )
  const update = (next: DotnetPublishRunConfiguration): void => {
    setDraft(next)
    setError(null)
  }
  const submit = (publish: boolean): void => {
    const problem = saveConfiguration(request, draft)
    if (problem) {
      setError(problem)
      return
    }
    onClose()
    if (publish) {
      void launchRunConfiguration({
        worktreeId: request.worktreeId,
        groupId: request.groupId,
        reference: draft.id
      })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="dotnet-publish-dialog"
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('run.publishDialog.title', 'Publish to folder')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'run.publishDialog.description',
              'Saved as a run configuration for this repository, so the Run widget can publish again with the same settings.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek -mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <FormField label={translate('run.configurations.form.name', 'Name')}>
            <Input
              value={draft.name}
              data-testid="dotnet-publish-name"
              onChange={(event) => update({ ...draft, name: event.target.value })}
            />
          </FormField>
          <DotnetPublishFields
            configuration={draft}
            disabled={false}
            browseRoot={browseRoot}
            onChange={update}
          />
        </div>
        <DialogFooter className="items-center">
          {error ? (
            <p data-testid="dotnet-publish-error" className="mr-auto text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button variant="outline" size="sm" onClick={onClose}>
            {translate('run.configurations.cancel', 'Cancel')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="dotnet-publish-save"
            onClick={() => submit(false)}
          >
            {translate('run.configurations.save', 'Save')}
          </Button>
          <Button size="sm" data-testid="dotnet-publish-run" onClick={() => submit(true)}>
            <Upload />
            {translate('run.publishConfirm.confirm', 'Publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
