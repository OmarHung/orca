import React from 'react'
import { NodeFileControls } from '../debug/NodeFileControls'
import { PythonFileControls } from '../python/PythonFileControls'
import { RecentRunControls } from './RecentRunControls'
import { RunConfigurationsWidget } from './RunConfigurationsWidget'

/** Fork run controls in the focused tab group's bar, left of the Quick Commands button. */
export function RunToolbar({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  return (
    <>
      <RunConfigurationsWidget worktreeId={worktreeId} />
      <RecentRunControls worktreeId={worktreeId} />
      <PythonFileControls />
      <NodeFileControls />
    </>
  )
}
