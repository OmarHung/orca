import { create } from 'zustand'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { dirname, getRelativePathInsideRoot, normalizeRelativePath } from '@/lib/path'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  newDotnetPublishConfiguration,
  type DotnetPublishRunConfiguration
} from '../../../../shared/run-configurations/dotnet-publish-configuration'
import { readTargetFrameworks } from '../../../../shared/run-configurations/dotnet-run-configurations'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { worktreeProjectFiles } from './project-run-detection'
import { uniqueName } from './run-configuration-drafts'
import { useRunConfigurationStore } from './run-configuration-store'

export type DotnetPublishDialogRequest = {
  worktreeId: string
  groupId: string | null
  repoId: string
  worktreePath: string
  /** The saved folder publish for the project, or a new one not saved yet. */
  configuration: DotnetPublishRunConfiguration
}

type DotnetPublishDialogState = {
  request: DotnetPublishDialogRequest | null
  open: (request: DotnetPublishDialogRequest) => void
  close: () => void
}

export const useDotnetPublishDialogStore = create<DotnetPublishDialogState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null })
}))

/** Relative to the workspace root, so the configuration works in every worktree of the repo. */
function workspaceRelative(path: string, worktreePath: string): string {
  const relative = getRelativePathInsideRoot(path, worktreePath)
  return relative === null ? path : normalizeRelativePath(relative)
}

function samePath(a: string, b: string): boolean {
  return normalizeRelativePath(a).toLowerCase() === normalizeRelativePath(b).toLowerCase()
}

/**
 * Rider's Publish: edit the project's folder publish (created on first use), then run it.
 * `asNew` always starts another one, e.g. for a second target folder.
 */
export async function openDotnetPublishDialog(
  detected: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null,
  options: { asNew?: boolean } = {}
): Promise<void> {
  const worktree = findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId)
  if (!worktree || !detected.projectFile) {
    return
  }
  const projectFile = workspaceRelative(detected.projectFile, worktree.path)
  const local = useRunConfigurationStore.getState().localByRepo[worktree.repoId] ?? []
  const saved = options.asNew
    ? undefined
    : local.find(
        (configuration): configuration is DotnetPublishRunConfiguration =>
          configuration.type === 'dotnet-publish' &&
          samePath(configuration.projectFile, projectFile)
      )
  const projectXml = saved
    ? null
    : await worktreeProjectFiles(worktreeId)?.files.readText(detected.projectFile)
  const created = newDotnetPublishConfiguration({
    id: createBrowserUuid(),
    projectName: detected.projectName,
    projectFile,
    projectDir: workspaceRelative(dirname(detected.projectFile), worktree.path),
    targetFrameworks: projectXml ? readTargetFrameworks(projectXml) : []
  })
  useDotnetPublishDialogStore.getState().open({
    worktreeId,
    groupId,
    repoId: worktree.repoId,
    worktreePath: worktree.path,
    configuration: saved ?? { ...created, name: uniqueName(created.name, local) }
  })
}

/** Opens a saved folder publish of this machine's configurations for editing. */
export function editDotnetPublishConfiguration(
  configuration: DotnetPublishRunConfiguration,
  worktreeId: string,
  groupId: string | null
): void {
  const worktree = findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId)
  if (worktree) {
    useDotnetPublishDialogStore.getState().open({
      worktreeId,
      groupId,
      repoId: worktree.repoId,
      worktreePath: worktree.path,
      configuration
    })
  }
}
