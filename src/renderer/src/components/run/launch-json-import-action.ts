import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
import {
  importLaunchJson,
  type LaunchJsonImport
} from '../../../../shared/run-configurations/launch-json-import'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { worktreeProjectFiles } from './project-run-detection'
import { mergeImportedConfigurations, useRunConfigurationStore } from './run-configuration-store'

/** Reads and converts the workspace's `.vscode/launch.json`; explains failures with a toast. */
export async function readWorkspaceLaunchJson(
  worktreeId: string
): Promise<Extract<LaunchJsonImport, { ok: true }> | null> {
  const workspace = worktreeProjectFiles(worktreeId)
  if (!workspace) {
    return null
  }
  const text = await workspace.files.readText(joinPath(workspace.root, '.vscode/launch.json'))
  if (text === null) {
    toast.error(
      translate('run.configurations.import.notFound', 'This workspace has no .vscode/launch.json')
    )
    return null
  }
  const result = importLaunchJson(text)
  if (!result.ok) {
    toast.error(
      translate('run.configurations.import.invalid', '.vscode/launch.json could not be read')
    )
    return null
  }
  return result
}

/** Merges an import into a configuration list and tells the user what came in and what didn't. */
export function mergeLaunchJsonImport(
  existing: readonly RunConfigurationDefinition[],
  result: Extract<LaunchJsonImport, { ok: true }>
): RunConfigurationDefinition[] {
  const merged = mergeImportedConfigurations(existing, result.configurations)
  const skipped = result.skipped.map((entry) => entry.name).join(', ')
  toast.success(
    translate(
      'run.configurations.import.done',
      'Imported {{value0}} new and {{value1}} updated configurations',
      { value0: merged.added, value1: merged.updated }
    ),
    skipped
      ? {
          description: translate(
            'run.configurations.import.skipped',
            'Not supported (attach, browsers, other runtimes): {{value0}}',
            { value0: skipped }
          )
        }
      : undefined
  )
  if (result.preLaunchTasks.length > 0) {
    toast.warning(
      translate(
        'run.configurations.import.preLaunchTasks',
        'VS Code tasks are not imported. Add a Before launch command for: {{value0}}',
        {
          value0: result.preLaunchTasks.map((entry) => `${entry.name} (${entry.task})`).join(', ')
        }
      )
    )
  }
  return merged.configurations
}

/** Imports the workspace's `.vscode/launch.json` into this repo's local configurations. */
export async function importWorkspaceLaunchJson(worktreeId: string, repoId: string): Promise<void> {
  const result = await readWorkspaceLaunchJson(worktreeId)
  if (!result) {
    return
  }
  const store = useRunConfigurationStore.getState()
  store.setLocal(repoId, mergeLaunchJsonImport(store.localByRepo[repoId] ?? [], result))
}
