import React from 'react'
import { NodeFileControls } from '../debug/NodeFileControls'
import { PythonFileControls } from '../python/PythonFileControls'
import { RunWidget } from './RunWidget'

/** Fork run controls in the focused tab group's bar: current-file runners, then the Run widget. */
export function RunToolbar({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  return (
    <>
      <PythonFileControls />
      <NodeFileControls />
      <RunWidget worktreeId={worktreeId} groupId={groupId} />
    </>
  )
}
