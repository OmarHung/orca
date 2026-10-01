import { create } from 'zustand'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  newDockerExportConfiguration,
  type DockerExportRunConfiguration
} from '../../../../shared/run-configurations/docker-export-configuration'
import { dockerExportStages } from '../../../../shared/run-configurations/dockerfile-run-configurations'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { resolveRunConfigurationPath } from '../../../../shared/run-configurations/run-configuration-variables'
import { worktreeProjectFiles } from './project-run-detection'
import { uniqueName } from './run-configuration-drafts'
import { useRunConfigurationStore } from './run-configuration-store'
import { workspaceRelativePath } from './workspace-relative-path'

export type DockerExportDialogRequest = {
  worktreeId: string
  groupId: string | null
  repoId: string
  worktreePath: string
  /** The saved export, or a new one not saved yet. */
  configuration: DockerExportRunConfiguration
  /** The Dockerfile's export stages, offered in the stage picker. */
  stages: string[]
}

type DockerExportDialogState = {
  request: DockerExportDialogRequest | null
  open: (request: DockerExportDialogRequest) => void
  close: () => void
}

export const useDockerExportDialogStore = create<DockerExportDialogState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null })
}))

function worktreeOf(worktreeId: string): { repoId: string; path: string } | null {
  return findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId) ?? null
}

/** Starts a new export of a detected Dockerfile, of `stage` or its first export stage. */
export function openDockerExportDialog(
  detected: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null,
  stage?: string
): void {
  const worktree = worktreeOf(worktreeId)
  const exportInfo = detected.dockerExport
  const target = stage ?? exportInfo?.stages[0]
  if (!worktree || !detected.projectFile || !exportInfo || !target) {
    return
  }
  const local = useRunConfigurationStore.getState().localByRepo[worktree.repoId] ?? []
  const created = newDockerExportConfiguration({
    id: createBrowserUuid(),
    dockerfile: workspaceRelativePath(detected.projectFile, worktree.path),
    context: workspaceRelativePath(exportInfo.contextDir, worktree.path) || '.',
    target
  })
  useDockerExportDialogStore.getState().open({
    worktreeId,
    groupId,
    repoId: worktree.repoId,
    worktreePath: worktree.path,
    configuration: { ...created, name: uniqueName(created.name, local) },
    stages: exportInfo.stages
  })
}

/** Opens a saved export of this machine's configurations, listing its Dockerfile's stages. */
export async function editDockerExportConfiguration(
  configuration: DockerExportRunConfiguration,
  worktreeId: string,
  groupId: string | null
): Promise<void> {
  const worktree = worktreeOf(worktreeId)
  if (!worktree) {
    return
  }
  const dockerfile = resolveRunConfigurationPath(configuration.dockerfile, {
    workspaceFolder: worktree.path
  })
  const text = dockerfile.ok
    ? await worktreeProjectFiles(worktreeId)?.files.readText(dockerfile.value)
    : null
  useDockerExportDialogStore.getState().open({
    worktreeId,
    groupId,
    repoId: worktree.repoId,
    worktreePath: worktree.path,
    configuration,
    stages: text ? dockerExportStages(text) : []
  })
}
