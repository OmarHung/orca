import React from 'react'
import { PythonInterpreterPicker } from '../python/PythonInterpreterPicker'
import { RunWidget } from './RunWidget'

/** Fork run controls in the focused tab group's bar: the Python interpreter, then the Run widget. */
export function RunToolbar({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  return (
    <>
      <PythonInterpreterPicker />
      <RunWidget worktreeId={worktreeId} groupId={groupId} />
    </>
  )
}
