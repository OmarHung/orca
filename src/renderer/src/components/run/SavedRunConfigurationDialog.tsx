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
import {
  normalizeRunConfigurationDefinitions,
  type RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import { launchRunConfiguration } from './run-configuration-launcher'
import { useRunConfigurationStore } from './run-configuration-store'
import { FormField } from './RunConfigurationFormField'
import { configurationItemKey } from './run-widget-items'

export type SavedRunConfigurationDialogScope = {
  worktreeId: string
  groupId: string | null
  repoId: string
}

/** Saves the configuration for the repository (replacing an earlier save) and selects it. */
function saveConfiguration(
  repoId: string,
  draft: RunConfigurationDefinition
): RunConfigurationDefinition | string {
  const { configurations, problems } = normalizeRunConfigurationDefinitions([draft])
  const [configuration] = configurations
  if (!configuration) {
    return problems[0]?.message ?? ''
  }
  const store = useRunConfigurationStore.getState()
  const local = store.localByRepo[repoId] ?? []
  const exists = local.some((entry) => entry.id === configuration.id)
  store.setLocal(
    repoId,
    exists
      ? local.map((entry) => (entry.id === configuration.id ? configuration : entry))
      : [...local, configuration]
  )
  store.select(repoId, configurationItemKey(configuration.id))
  return configuration
}

/**
 * Edits one saved configuration outside Edit Configurations (a folder publish or export): its
 * name, the fields `renderFields` draws, then Save, or Save and run it.
 */
export function SavedRunConfigurationDialog<T extends RunConfigurationDefinition>({
  scope,
  initial,
  testIdPrefix,
  title,
  description,
  runLabel,
  onClose,
  renderFields
}: {
  scope: SavedRunConfigurationDialogScope
  initial: T
  testIdPrefix: string
  title: string
  description: string
  runLabel: string
  onClose: () => void
  renderFields: (draft: T, update: (next: T) => void) => React.ReactNode
}): React.JSX.Element {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const update = (next: T): void => {
    setDraft(next)
    setError(null)
  }
  const submit = (run: boolean): void => {
    const saved = saveConfiguration(scope.repoId, draft)
    if (typeof saved === 'string') {
      setError(saved || null)
      return
    }
    onClose()
    if (run) {
      void launchRunConfiguration({
        worktreeId: scope.worktreeId,
        groupId: scope.groupId,
        reference: saved.id
      })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid={`${testIdPrefix}-dialog`}
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek -mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <FormField label={translate('run.configurations.form.name', 'Name')}>
            <Input
              value={draft.name}
              data-testid={`${testIdPrefix}-name`}
              onChange={(event) => update({ ...draft, name: event.target.value })}
            />
          </FormField>
          {renderFields(draft, update)}
        </div>
        <DialogFooter className="items-center">
          {error ? (
            <p data-testid={`${testIdPrefix}-error`} className="mr-auto text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button variant="outline" size="sm" onClick={onClose}>
            {translate('run.configurations.cancel', 'Cancel')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid={`${testIdPrefix}-save`}
            onClick={() => submit(false)}
          >
            {translate('run.configurations.save', 'Save')}
          </Button>
          <Button size="sm" data-testid={`${testIdPrefix}-run`} onClick={() => submit(true)}>
            <Upload />
            {runLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
