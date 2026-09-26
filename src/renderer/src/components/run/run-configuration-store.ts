import { create } from 'zustand'
import {
  normalizeRunConfigurationDefinitions,
  type RunConfigurationDefinition,
  type RunConfigurationProblem
} from '../../../../shared/run-configurations/run-configuration-definition'

const STORAGE_KEY = 'orca.run.configurationsByRepo.v1'

export type RunConfigurationSource = 'local' | 'shared'

export type ListedRunConfiguration = {
  configuration: RunConfigurationDefinition
  /** `shared` comes from the workspace's orca.yaml and needs trust approval to run. */
  source: RunConfigurationSource
}

export type SharedRunConfigurations = {
  status: 'loading' | 'ready'
  configurations: RunConfigurationDefinition[]
  problems: RunConfigurationProblem[]
}

type StoredRepo = { configurations: RunConfigurationDefinition[]; selected?: string }

export function readStoredRunConfigurations(): {
  localByRepo: Record<string, RunConfigurationDefinition[]>
  selectedByRepo: Record<string, string>
} {
  const localByRepo: Record<string, RunConfigurationDefinition[]> = {}
  const selectedByRepo: Record<string, string> = {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (typeof value !== 'object' || value === null) {
      return { localByRepo, selectedByRepo }
    }
    for (const [repoId, entry] of Object.entries(value)) {
      if (typeof entry !== 'object' || entry === null) {
        continue
      }
      const record: Record<string, unknown> = { ...entry }
      localByRepo[repoId] = normalizeRunConfigurationDefinitions(
        record.configurations
      ).configurations
      if (typeof record.selected === 'string') {
        selectedByRepo[repoId] = record.selected
      }
    }
  } catch {
    // Unreadable storage starts empty rather than blocking the tab bar.
  }
  return { localByRepo, selectedByRepo }
}

function writeStored(
  localByRepo: Record<string, RunConfigurationDefinition[]>,
  selectedByRepo: Record<string, string>
): void {
  const stored: Record<string, StoredRepo> = {}
  for (const repoId of new Set([...Object.keys(localByRepo), ...Object.keys(selectedByRepo)])) {
    stored[repoId] = {
      configurations: localByRepo[repoId] ?? [],
      ...(selectedByRepo[repoId] ? { selected: selectedByRepo[repoId] } : {})
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage can be unavailable; changes then last only for this window.
  }
}

/** Re-importing launch.json updates the configurations it created earlier instead of duplicating them. */
export function mergeImportedConfigurations(
  existing: readonly RunConfigurationDefinition[],
  imported: readonly RunConfigurationDefinition[]
): { configurations: RunConfigurationDefinition[]; added: number; updated: number } {
  const importedById = new Map(imported.map((configuration) => [configuration.id, configuration]))
  const configurations = existing.map(
    (configuration) => importedById.get(configuration.id) ?? configuration
  )
  const existingIds = new Set(existing.map((configuration) => configuration.id))
  const added = imported.filter((configuration) => !existingIds.has(configuration.id))
  return {
    configurations: [...configurations, ...added],
    added: added.length,
    updated: imported.length - added.length
  }
}

/** Local configurations win over shared ones with the same id. */
export function combineRunConfigurations(
  local: readonly RunConfigurationDefinition[],
  shared: readonly RunConfigurationDefinition[]
): ListedRunConfiguration[] {
  const localIds = new Set(local.map((configuration) => configuration.id))
  return [
    ...local.map((configuration) => ({ configuration, source: 'local' as const })),
    ...shared
      .filter((configuration) => !localIds.has(configuration.id))
      .map((configuration) => ({ configuration, source: 'shared' as const }))
  ]
}

type RunConfigurationState = {
  localByRepo: Record<string, RunConfigurationDefinition[]>
  selectedByRepo: Record<string, string>
  sharedByWorktree: Record<string, SharedRunConfigurations>
  setLocal: (repoId: string, configurations: RunConfigurationDefinition[]) => void
  select: (repoId: string, id: string) => void
  setShared: (worktreeId: string, shared: SharedRunConfigurations) => void
}

// Why localStorage, not synced settings: the shared quick command shape must stay unchanged
// for mobile/older clients, and repo-wide sharing goes through orca.yaml instead.
export const useRunConfigurationStore = create<RunConfigurationState>((set, get) => ({
  ...readStoredRunConfigurations(),
  sharedByWorktree: {},
  setLocal: (repoId, configurations) => {
    const localByRepo = { ...get().localByRepo, [repoId]: configurations }
    set({ localByRepo })
    writeStored(localByRepo, get().selectedByRepo)
  },
  select: (repoId, id) => {
    const selectedByRepo = { ...get().selectedByRepo, [repoId]: id }
    set({ selectedByRepo })
    writeStored(get().localByRepo, selectedByRepo)
  },
  setShared: (worktreeId, shared) =>
    set({ sharedByWorktree: { ...get().sharedByWorktree, [worktreeId]: shared } })
}))
