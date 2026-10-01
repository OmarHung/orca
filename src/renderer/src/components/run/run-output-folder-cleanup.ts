import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { deleteRuntimePath } from '@/runtime/runtime-file-mutation-client'
import { runtimePathExists } from '@/runtime/runtime-file-metadata-client'
import { dockerExportContext } from '../../../../shared/run-configurations/docker-export-configuration'
import { outputFolderEmptyingProblem } from '../../../../shared/run-configurations/output-folder-safety'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import {
  resolveRunConfigurationPath,
  type RunConfigurationVariableContext
} from '../../../../shared/run-configurations/run-configuration-variables'
import { getTabEntryFileOperationContext } from '../tab-bar/tab-create-entry-local-path'
import { stopConfigurationAndWait, type RunTarget } from './run-configuration-control'

/** An output folder to empty before a run, and the build context it must not swallow. */
export type OutputFolderToEmpty = { folder: string; contextDir: string }

/** Docker exports set to empty their folder first, by configuration id, as absolute paths. */
export function outputFoldersToEmpty(
  configurations: readonly RunConfigurationDefinition[],
  context: RunConfigurationVariableContext
): Map<string, OutputFolderToEmpty> {
  const folders = new Map<string, OutputFolderToEmpty>()
  for (const configuration of configurations) {
    if (configuration.type !== 'docker-export' || !configuration.cleanOutputDir) {
      continue
    }
    const folder = resolveRunConfigurationPath(configuration.outputDir, context)
    const contextDir = resolveRunConfigurationPath(dockerExportContext(configuration), context)
    if (folder.ok && contextDir.ok) {
      folders.set(configuration.id, { folder: folder.value, contextDir: contextDir.value })
    }
  }
  return folders
}

function problemMessage(problem: 'not-absolute' | 'system-folder' | 'contains-sources'): string {
  switch (problem) {
    case 'not-absolute':
      return translate('run.emptyOutput.notAbsolute', 'its path could not be resolved')
    case 'system-folder':
      return translate('run.emptyOutput.systemFolder', 'it is a root, home or system folder')
    case 'contains-sources':
      return translate(
        'run.emptyOutput.containsSources',
        'it holds the workspace or the build context'
      )
  }
}

function emptyFailed(name: string, folder: string, reason: string): false {
  toast.error(
    translate('run.emptyOutput.failed', "'{{value0}}' did not run: could not empty {{value1}}", {
      value0: name,
      value1: folder
    }),
    { description: reason }
  )
  return false
}

/**
 * Empties an export's output folder on the host that owns the workspace (to the Trash on this
 * computer); false, after telling the user, when the folder is unsafe or could not be emptied.
 */
export async function emptyOutputFolder(
  worktreeId: string,
  name: string,
  target: OutputFolderToEmpty
): Promise<boolean> {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  if (!worktree) {
    return false
  }
  const problem = outputFolderEmptyingProblem(target.folder, {
    workspaceRoot: worktree.path,
    contextDir: target.contextDir
  })
  if (problem) {
    return emptyFailed(name, target.folder, problemMessage(problem))
  }
  const context = getTabEntryFileOperationContext(state, worktreeId, worktree.path)
  try {
    if (!context.connectionId) {
      // Why: this computer only touches folders outside its workspaces once allowed to.
      await window.api.fs.authorizeExternalPath({ targetPath: target.folder })
    }
    if (await runtimePathExists(context, target.folder)) {
      await deleteRuntimePath(context, target.folder, true)
    }
    return true
  } catch (error) {
    return emptyFailed(name, target.folder, error instanceof Error ? error.message : String(error))
  }
}

/** Ends the previous run of `target`, then empties the folder it exports to, when it has one. */
export async function prepareOutputFolder(
  name: string,
  target: RunTarget,
  output: OutputFolderToEmpty | undefined,
  pending: { cancelled: boolean }
): Promise<boolean> {
  if (!output) {
    return true
  }
  await stopConfigurationAndWait(target)
  return !pending.cancelled && (await emptyOutputFolder(target.worktreeId, name, output))
}
