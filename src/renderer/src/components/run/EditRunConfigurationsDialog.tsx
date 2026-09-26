import React, { useState } from 'react'
import { FileInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import {
  mergeLaunchJsonImport,
  readWorkspaceLaunchJson,
  useWorkspaceHasLaunchJson
} from './launch-json-import-action'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { detectedCommandConfiguration, unsavedDetectedRuns } from './compound-run-draft'
import { RunConfigurationForm } from './RunConfigurationForm'
import { RunConfigurationListPane } from './RunConfigurationListPane'
import {
  duplicateConfiguration,
  newConfiguration,
  validateDrafts,
  type RunConfigurationType
} from './run-configuration-drafts'
import { useRunConfigurationStore } from './run-configuration-store'
import type { WorktreeRunConfigurations } from './use-worktree-run-configurations'
import { useWorkspaceDetectedRuns } from './use-workspace-detected-runs'

/** JetBrains-style Edit Configurations: list on the left, the selected one's form on the right. */
export function EditRunConfigurationsDialog({
  worktreeId,
  data,
  onOpenChange
}: {
  worktreeId: string
  data: WorktreeRunConfigurations
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<RunConfigurationDefinition[]>(() => data.local)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => data.selected?.configuration.id ?? data.listed[0]?.configuration.id ?? null
  )
  const [errors, setErrors] = useState<string[]>([])
  // Why: an import can rewrite the open form's configuration, so the form must remount.
  const [importRevision, setImportRevision] = useState(0)
  const hasLaunchJson = useWorkspaceHasLaunchJson(worktreeId, null)
  const detected = useWorkspaceDetectedRuns(worktreeId)
  const localIds = new Set(drafts.map((draft) => draft.id))
  const shared = (data.shared?.configurations ?? []).filter((entry) => !localIds.has(entry.id))
  const all = [...drafts, ...shared]
  const selectedLocal = drafts.find((draft) => draft.id === selectedId) ?? null
  const selected = selectedLocal ?? shared.find((entry) => entry.id === selectedId) ?? null

  const add = (type: RunConfigurationType): void => {
    const created = newConfiguration(type, all, createBrowserUuid)
    setDrafts([...drafts, created])
    setSelectedId(created.id)
  }
  const duplicate = (): void => {
    if (selected) {
      const copy = duplicateConfiguration(selected, all, createBrowserUuid)
      setDrafts([...drafts, copy])
      setSelectedId(copy.id)
    }
  }
  const remove = (): void => {
    const remaining = drafts.filter((draft) => draft.id !== selectedId)
    setDrafts(remaining)
    setSelectedId(remaining[0]?.id ?? shared[0]?.id ?? null)
  }
  // Why functional: picking a detected run adds its configuration and updates the compound in one event.
  const update = (next: RunConfigurationDefinition): void => {
    setDrafts((current) => current.map((draft) => (draft.id === next.id ? next : draft)))
    setErrors([])
  }
  const pickDetected = (run: DetectedRunConfiguration): string => {
    const { id, created } = detectedCommandConfiguration(
      run,
      all,
      data.worktreePath,
      createBrowserUuid
    )
    if (created) {
      setDrafts((current) => [...current, created])
    }
    return id
  }
  const importLaunchJson = async (): Promise<void> => {
    const result = await readWorkspaceLaunchJson(worktreeId)
    if (result) {
      setDrafts(mergeLaunchJsonImport(drafts, result))
      setImportRevision(importRevision + 1)
    }
  }
  const save = (): void => {
    const validation = validateDrafts(drafts)
    if (!validation.ok) {
      setErrors(validation.messages)
      return
    }
    const store = useRunConfigurationStore.getState()
    store.setLocal(data.repoId, validation.configurations)
    if (selectedId) {
      store.select(data.repoId, selectedId)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="edit-run-configurations-dialog"
        className="flex h-[min(80vh,40rem)] w-full max-w-4xl flex-col overflow-hidden sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('run.configurations.dialogTitle', 'Run/Debug Configurations')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'run.configurations.dialogDescription',
              'Configurations under This machine are saved locally for this repository. Shared ones come from orca.yaml.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          <RunConfigurationListPane
            local={drafts}
            shared={shared}
            sharedProblems={data.shared?.problems ?? []}
            selectedId={selectedId}
            selectedIsLocal={selectedLocal !== null}
            onSelect={setSelectedId}
            onAdd={add}
            onDuplicate={duplicate}
            onDelete={remove}
          />
          <div className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {selected ? (
              <>
                {selectedLocal ? null : (
                  <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {translate(
                      'run.configurations.sharedReadOnly',
                      'Defined in orca.yaml. Edit that file to change it, or duplicate it to make a local copy. Orca asks before running it.'
                    )}
                  </p>
                )}
                <RunConfigurationForm
                  key={`${selected.id}:${importRevision}`}
                  configuration={selected}
                  all={all}
                  readOnly={selectedLocal === null}
                  detected={unsavedDetectedRuns(detected, all, data.worktreePath)}
                  worktreePath={data.worktreePath}
                  onChange={update}
                  onPickDetected={pickDetected}
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate('run.configurations.nothingSelected', 'Select or add a configuration.')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          {hasLaunchJson ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="run-configurations-dialog-import"
              onClick={() => void importLaunchJson()}
            >
              <FileInput />
              {translate('run.configurations.importLaunchJson', 'Import .vscode/launch.json')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {errors.length > 0 ? (
              <p
                data-testid="run-configurations-errors"
                className="max-w-sm truncate text-xs text-destructive"
                title={errors.join('\n')}
              >
                {errors[0]}
              </p>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {translate('run.configurations.cancel', 'Cancel')}
            </Button>
            <Button size="sm" data-testid="run-configurations-save" onClick={save}>
              {translate('run.configurations.save', 'Save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
