import React from 'react'
import { PythonFileControls } from '../python/PythonFileControls'
import { RecentRunControls } from './RecentRunControls'

/** Fork run controls in the focused tab group's bar, left of the Quick Commands button. */
export function RunToolbar({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  return (
    <>
      <RecentRunControls worktreeId={worktreeId} />
      <PythonFileControls />
    </>
  )
}
