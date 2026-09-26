import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { findRunConfiguration } from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { loadSharedRunConfigurations } from './run-configuration-launcher'
import {
  combineRunConfigurations,
  useRunConfigurationStore,
  type ListedRunConfiguration,
  type SharedRunConfigurations
} from './run-configuration-store'

const NO_CONFIGURATIONS: RunConfigurationDefinition[] = []

export type WorktreeRunConfigurations = {
  repoId: string
  worktreePath: string
  local: RunConfigurationDefinition[]
  shared: SharedRunConfigurations | undefined
  listed: ListedRunConfiguration[]
  selected: ListedRunConfiguration | null
}

/** Local (this machine) plus orca.yaml configurations for a workspace, loading orca.yaml once. */
export function useWorktreeRunConfigurations(worktreeId: string): WorktreeRunConfigurations | null {
  const worktree = useAppStore((s) => findWorktreeById(s.worktreesByRepo, worktreeId))
  const repoId = worktree?.repoId ?? ''
  const local = useRunConfigurationStore((s) => s.localByRepo[repoId] ?? NO_CONFIGURATIONS)
  const selectedId = useRunConfigurationStore((s) => s.selectedByRepo[repoId])
  const shared = useRunConfigurationStore((s) => s.sharedByWorktree[worktreeId])
  const hasShared = shared !== undefined

  useEffect(() => {
    if (worktree && !hasShared) {
      void loadSharedRunConfigurations(worktreeId)
    }
  }, [hasShared, worktree, worktreeId])

  const listed = useMemo(
    () => combineRunConfigurations(local, shared?.configurations ?? NO_CONFIGURATIONS),
    [local, shared]
  )
  if (!worktree) {
    return null
  }
  const selectedConfiguration = selectedId
    ? findRunConfiguration(
        listed.map((entry) => entry.configuration),
        selectedId
      )
    : null
  const selected =
    listed.find((entry) => entry.configuration === selectedConfiguration) ?? listed[0] ?? null
  return { repoId, worktreePath: worktree.path, local, shared, listed, selected }
}
