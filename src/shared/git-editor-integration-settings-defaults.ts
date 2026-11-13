import type { GitEditorIntegrationSettings } from './git-editor-integration-settings-types'

export const DEFAULT_GIT_EDITOR_INTEGRATION_SETTINGS: GitEditorIntegrationSettings = {
  gitBranchStatusBarEnabled: true,
  gitAutoFetchEnabled: false,
  gitAutoFetchIntervalMinutes: 15,
  gitInlineBlameEnabled: true,
  editorChangeMarkersEnabled: true,
  gitCherryPickRecordOrigin: true
}
