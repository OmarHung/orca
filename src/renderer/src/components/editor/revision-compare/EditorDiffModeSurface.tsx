import type React from 'react'
import { ChangesModeView } from '../panel/ChangesModeView'
import { ExternalChangeBannerFrame } from '../ExternalChangeBannerFrame'
import { RevisionCompareView } from './RevisionCompareView'
import type { RevisionCompareBaseline } from './revision-compare-store'

type EditorDiffModeSurfaceProps = React.ComponentProps<typeof ChangesModeView> & {
  banner: React.ReactNode
  revisionBaseline: RevisionCompareBaseline | undefined
}

/** Fork: a branch/revision compare takes the changes view's place while it is open. */
export function EditorDiffModeSurface({
  banner,
  revisionBaseline,
  ...changes
}: EditorDiffModeSurfaceProps): React.JSX.Element {
  return (
    <ExternalChangeBannerFrame banner={banner}>
      {revisionBaseline ? (
        <RevisionCompareView
          file={changes.activeFile}
          baseline={revisionBaseline}
          modifiedContent={changes.modifiedContent}
          language={changes.resolvedLanguage}
          sideBySide={changes.sideBySide}
          viewStateScopeId={changes.viewStateScopeId}
          diffViewStateKey={changes.diffViewStateKey}
          onContentChange={changes.onContentChange}
          onSave={changes.onSave}
        />
      ) : (
        <ChangesModeView {...changes} />
      )}
    </ExternalChangeBannerFrame>
  )
}
