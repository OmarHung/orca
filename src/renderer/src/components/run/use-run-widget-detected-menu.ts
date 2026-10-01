import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { detectedRunWidgetItem } from './detected-run-configuration'
import { detectedRunHideKey, detectedRunMenu, type DetectedRunMenu } from './detected-run-menu'
import { useDetectedRunVisibilityStore } from './detected-run-visibility-store'
import { editDockerExportConfiguration, openDockerExportDialog } from './docker-export-dialog-store'
import {
  editDotnetPublishConfiguration,
  openDotnetPublishDialog
} from './dotnet-publish-dialog-store'
import type { DetectedSectionActions } from './RunWidgetDetectedSection'
import { configurationItemKey, type RunWidgetItem } from './run-widget-items'
import { useRunWidgetDetectedRuns } from './use-run-widget-detected-runs'
import { savedRunFor } from './saved-command-match'

const NO_HIDDEN: string[] = []

/** The Run widget's Detected section: what to list, and what its rows and entries do. */
export function useRunWidgetDetectedMenu(options: {
  worktreeId: string
  groupId: string | null
  menuOpen: boolean
  /** null until the worktree's run configurations are known. */
  workspace: { repoId: string; worktreePath: string } | null
  items: readonly RunWidgetItem[]
  configurations: readonly RunConfigurationDefinition[]
  closeMenu: () => void
}): { menu: DetectedRunMenu | null; actions: DetectedSectionActions } {
  const { worktreeId, groupId, workspace, items } = options
  const runs = useRunWidgetDetectedRuns(worktreeId, options.menuOpen)
  const hidden = useDetectedRunVisibilityStore((s) =>
    workspace ? (s.hiddenByRepo[workspace.repoId] ?? NO_HIDDEN) : NO_HIDDEN
  )
  const worktreePath = workspace?.worktreePath ?? ''
  const repoId = workspace?.repoId
  return {
    menu:
      runs && workspace
        ? detectedRunMenu(runs, worktreePath, new Set(hidden), options.configurations)
        : null,
    actions: {
      toItem: (run) => {
        const item = detectedRunWidgetItem(run, worktreeId, groupId)
        const saved = savedRunFor(item.target, options.configurations, worktreePath)
        return saved ? { ...item, savedTarget: saved.target } : item
      },
      savedItem: (id) => items.find((item) => item.key === configurationItemKey(id)) ?? null,
      onNewPublish: (run) =>
        void openDotnetPublishDialog(run, worktreeId, groupId, { asNew: true }),
      onNewDockerExport: (run, stage) => openDockerExportDialog(run, worktreeId, groupId, stage),
      onEditPublish: (configuration) => {
        options.closeMenu()
        if (configuration.type === 'docker-export') {
          void editDockerExportConfiguration(configuration, worktreeId, groupId)
        } else {
          editDotnetPublishConfiguration(configuration, worktreeId, groupId)
        }
      },
      hideKeyOf: (run) => detectedRunHideKey(run, worktreePath),
      onHide: (key) => {
        if (repoId) {
          useDetectedRunVisibilityStore.getState().hide(repoId, key)
        }
      },
      onShow: (keys) => {
        if (repoId) {
          useDetectedRunVisibilityStore.getState().show(repoId, keys)
        }
      }
    }
  }
}
