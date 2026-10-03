// Why a separate type: keeps these fork settings out of global-settings-types.ts, which sits at its line cap.
export type GitEditorIntegrationSettings = {
  /** Status-bar segment with the active workspace's branch, ahead/behind and change count. */
  gitBranchStatusBarEnabled: boolean
  /** Periodically runs `git fetch` for the active workspace's repository. */
  gitAutoFetchEnabled: boolean
  /** Minutes between automatic fetches of one repository. */
  gitAutoFetchIntervalMinutes: number
  /** GitLens-style author/date/summary after the caret line in file editors. */
  gitInlineBlameEnabled: boolean
  /** JetBrains-style gutter bars for lines that differ from HEAD in file editors. */
  editorChangeMarkersEnabled: boolean
}
