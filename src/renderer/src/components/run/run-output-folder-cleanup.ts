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

/**
 * An output folder emptied before a run, and the build context it must not swallow. The command's
 * own `rm -rf` empties it in a POSIX shell; elsewhere Orca deletes it (`orcaDeletes`).
 */
export type OutputFolderToEmpty = { folder: string; contextDir: string; orcaDeletes: boolean }

/** Docker exports set to empty their folder first, by configuration id, as absolute paths. */
export function outputFoldersToEmpty(
  configurations: readonly RunConfigurationDefinition[],
  context: RunConfigurationVariableContext,
  options: { orcaDeletes: boolean }
): Map<string, OutputFolderToEmpty> {
  const folders = new Map<string, OutputFolderToEmpty>()
  for (const configuration of configurations) {
    if (configuration.type !== 'docker-export' || !configuration.cleanOutputDir) {
      continue
    }
    const folder = resolveRunConfigurationPath(configuration.outputDir, context)
    const contextDir = resolveRunConfigurationPath(dockerExportContext(configuration), context)
    if (folder.ok && contextDir.ok) {
      folders.set(configuration.id, {
        folder: folder.value,
        contextDir: contextDir.value,
        orcaDeletes: options.orcaDeletes
      })
    }
  }
  return folders
}

export function outputFolderProblemMessage(
  problem: 'not-absolute' | 'system-folder' | 'contains-sources'
): string {
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

/** False, after telling the user, when the folder must not be emptied (see output-folder-safety). */
function checkOutputFolder(
  worktreePath: string,
  name: string,
  target: OutputFolderToEmpty
): boolean {
  const problem = outputFolderEmptyingProblem(target.folder, {
    workspaceRoot: worktreePath,
    contextDir: target.contextDir
  })
  return problem ? emptyFailed(name, target.folder, outputFolderProblemMessage(problem)) : true
}

/**
 * Checks an export's output folder may be emptied, and empties it when Orca does that (to the
 * Trash on this computer); false, after telling the user, when it is unsafe or could not be emptied.
 */
export async function emptyOutputFolder(
  worktreeId: string,
  name: string,
  target: OutputFolderToEmpty
): Promise<boolean> {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  if (!worktree || !checkOutputFolder(worktree.path, name, target)) {
    return false
  }
  if (!target.orcaDeletes) {
    return true
  }
  const context = getTabEntryFileOperationContext(state, worktreeId, worktree.path)
  try {
    // Why: locally main deletes only inside a project; a folder outside one fails and is reported.
    if (await runtimePathExists(context, target.folder)) {
      await deleteRuntimePath(context, target.folder, true)
    }
    return true
  } catch (error) {
    return emptyFailed(name, target.folder, error instanceof Error ? error.message : String(error))
  }
}

/** Before an export: refuses an unsafe output folder, and empties it when Orca does that. */
export async function prepareOutputFolder(
  name: string,
  target: RunTarget,
  output: OutputFolderToEmpty | undefined,
  pending: { cancelled: boolean }
): Promise<boolean> {
  if (!output) {
    return true
  }
  // Why stop first: the previous export must not write into the folder once it is emptied.
  if (output.orcaDeletes) {
    await stopConfigurationAndWait(target)
  }
  return !pending.cancelled && (await emptyOutputFolder(target.worktreeId, name, output))
}
