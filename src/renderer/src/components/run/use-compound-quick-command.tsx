import React, { useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  CompoundRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { CompoundMembersEditor } from './CompoundMembersEditor'
import {
  detectedCommandConfiguration,
  newSequentialCompound,
  unsavedDetectedRuns,
  withoutUnusedCreated
} from './compound-run-draft'
import { uniqueName } from './run-configuration-drafts'
import { useRunConfigurationStore } from './run-configuration-store'
import { configurationItemKey } from './run-widget-items'
import { useWorkspaceDetectedRuns } from './use-workspace-detected-runs'
import { useWorktreeRunConfigurations } from './use-worktree-run-configurations'

export type CompoundQuickCommand = {
  editor: React.ReactNode
  canSave: boolean
  /** Saves the compound as a local run configuration and selects it in the Run widget. */
  save: (name: string) => void
}

/** The Compound action of the Add Quick Command dialog, for the workspace it was opened from. */
export function useCompoundQuickCommand(worktreeId: string): CompoundQuickCommand | null {
  const data = useWorktreeRunConfigurations(worktreeId)
  const detected = useWorkspaceDetectedRuns(worktreeId)
  const [compound, setCompound] = useState<CompoundRunConfiguration>(() =>
    newSequentialCompound(createBrowserUuid())
  )
  const [created, setCreated] = useState<RunConfigurationDefinition[]>([])
  if (!data) {
    return null
  }
  const all = [...data.listed.map((entry) => entry.configuration), ...created]

  const pickDetected = (run: DetectedRunConfiguration): string => {
    const result = detectedCommandConfiguration(run, all, data.worktreePath, createBrowserUuid)
    const configuration = result.created
    if (configuration) {
      setCreated((current) => [...current, configuration])
    }
    return result.id
  }

  const save = (name: string): void => {
    const store = useRunConfigurationStore.getState()
    const local = store.localByRepo[data.repoId] ?? []
    const createdIds = new Set(created.map((configuration) => configuration.id))
    const kept = withoutUnusedCreated([...local, ...created], createdIds, compound)
    store.setLocal(data.repoId, [...kept, { ...compound, name: uniqueName(name, kept) }])
    store.select(data.repoId, configurationItemKey(compound.id))
    toast.success(
      translate('run.compound.savedToast', "Saved '{{value0}}' to Run configurations", {
        value0: name
      })
    )
  }

  return {
    editor: (
      <CompoundMembersEditor
        compound={compound}
        all={all}
        detected={unsavedDetectedRuns(detected, all, data.worktreePath)}
        readOnly={false}
        worktreePath={data.worktreePath}
        onChange={setCompound}
        onPickDetected={pickDetected}
      />
    ),
    canSave: compound.configurations.length > 0,
    save
  }
}
