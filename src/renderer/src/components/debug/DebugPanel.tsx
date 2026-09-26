import React from 'react'
import { DebugFramesList } from './DebugFramesList'
import { DebugSidePane } from './DebugSidePane'
import { DebugToolbar } from './DebugToolbar'
import { DebugVariablesTree } from './DebugVariablesTree'
import { DebugWatchList } from './DebugWatchList'

/** JetBrains-style Debug tool window: toolbar, then Frames | Variables | Console/Breakpoints. */
export function DebugPanel(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="debug-panel">
      <DebugToolbar />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(160px,1fr)_minmax(200px,2fr)_minmax(200px,2fr)] divide-x divide-border">
        <DebugFramesList />
        <div className="grid min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] divide-y divide-border">
          <DebugVariablesTree />
          <DebugWatchList />
        </div>
        <DebugSidePane />
      </div>
    </div>
  )
}
