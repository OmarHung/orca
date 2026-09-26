import React from 'react'
import { translate } from '@/i18n/i18n'
import { DEBUG_MIN_VARIABLES_HEIGHT } from '../bottom-panel/bottom-panel-layout-store'
import { ResizeHandle } from '../bottom-panel/ResizeHandle'
import { DebugFramesList } from './DebugFramesList'
import { DebugSidePane } from './DebugSidePane'
import { DebugToolbar } from './DebugToolbar'
import { DebugVariablesTree } from './DebugVariablesTree'
import { DebugWatchList } from './DebugWatchList'
import { useDebugPanelResize } from './use-debug-panel-resize'

/** JetBrains-style Debug tool window: toolbar, then Frames | Variables/Watches | Console/Breakpoints. */
export function DebugPanel(): React.JSX.Element {
  const { rootRef, middleRef, framesResize, sidePaneResize, watchesResize } = useDebugPanelResize()
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="debug-panel">
      <DebugToolbar />
      <div ref={rootRef} className="flex min-h-0 flex-1">
        <div
          className="relative shrink-0 border-r border-border"
          data-testid="debug-frames-region"
          style={{ width: framesResize.size, maxWidth: '40%' }}
        >
          <ResizeHandle
            edge="right"
            label={translate('debug.resize.frames', 'Resize frames')}
            handleProps={framesResize.handleProps}
          />
          <DebugFramesList />
        </div>
        <div ref={middleRef} className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <DebugVariablesTree />
          </div>
          <div
            className="relative shrink-0 border-t border-border"
            data-testid="debug-watches-region"
            style={{
              height: watchesResize.size,
              maxHeight: `calc(100% - ${DEBUG_MIN_VARIABLES_HEIGHT}px)`
            }}
          >
            <ResizeHandle
              edge="top"
              label={translate('debug.resize.watches', 'Resize watches')}
              handleProps={watchesResize.handleProps}
            />
            <DebugWatchList />
          </div>
        </div>
        <div
          className="relative shrink-0 border-l border-border"
          data-testid="debug-side-region"
          style={{ width: sidePaneResize.size, maxWidth: '60%' }}
        >
          <ResizeHandle
            edge="left"
            label={translate('debug.resize.sidePane', 'Resize console and breakpoints')}
            handleProps={sidePaneResize.handleProps}
          />
          <DebugSidePane />
        </div>
      </div>
    </div>
  )
}
