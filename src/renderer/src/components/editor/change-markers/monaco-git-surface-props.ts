import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type { GitDiffResult } from '../../../../../shared/git/diff/git-diff-compare-types'
import { canUseChangesModeForFile } from '../view-mode/editor-panel-file-mode'
import { getChangeMarkersBaseline } from './change-markers-baseline'

/** The git inputs the Edit view's Monaco reads: its change-marker baseline and the path to blame. */
export function monacoGitSurfaceProps(
  file: OpenFile,
  diff: GitDiffResult | undefined,
  showChangeMarkers: boolean
): { changeMarkersBaseline: string | null; gitRelativePath: string | null } {
  return {
    changeMarkersBaseline: showChangeMarkers ? getChangeMarkersBaseline(diff) : null,
    gitRelativePath:
      canUseChangesModeForFile(file) && file.readOnly !== true ? file.relativePath : null
  }
}
