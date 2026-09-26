import React from 'react'
import { NodeFileControls } from '../debug/NodeFileControls'
import { PythonFileControls } from '../python/PythonFileControls'
import { RunWidget } from './RunWidget'

/** Fork run controls in the focused tab group's bar: current-file runners, then the Run widget. */
export function RunToolbar({
  worktreeId,
  groupId,
  activeTerminalTabId
}: {
  worktreeId: string
  groupId: string
  activeTerminalTabId: string | null
}): React.JSX.Element {
  return (
    <>
      <PythonFileControls />
      <NodeFileControls />
      <RunWidget
        worktreeId={worktreeId}
        groupId={groupId}
        activeTerminalTabId={activeTerminalTabId}
      />
    </>
  )
}
