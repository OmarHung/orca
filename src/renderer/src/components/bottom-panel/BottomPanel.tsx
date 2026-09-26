import React, { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT,
  BOTTOM_PANEL_SIZE_LIMITS,
  useBottomPanelLayout,
  type BottomPanelTab
} from './bottom-panel-layout-store'
import { ResizeHandle } from './ResizeHandle'
import { useBottomPanelRegionResize } from './use-bottom-panel-region-resize'

const GitLogView = lazy(() =>
  import('./git-log/GitLogView').then((module) => ({
    default: module.GitLogView
  }))
)
const DebugPanel = lazy(() =>
  import('../debug/DebugPanel').then((module) => ({
    default: module.DebugPanel
  }))
)

function BottomPanelTabButton({
  tab,
  label
}: {
  tab: BottomPanelTab
  label: string
}): React.JSX.Element {
  const active = useBottomPanelLayout((s) => s.activeTab === tab)
  const showTab = useBottomPanelLayout((s) => s.showTab)
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'rounded-md px-2 py-0.5 text-xs transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
      onClick={() => showTab(tab)}
    >
      {label}
    </button>
  )
}

export function BottomPanel(): React.JSX.Element {
  const setOpen = useBottomPanelLayout((s) => s.setOpen)
  const activeTab = useBottomPanelLayout((s) => s.activeTab)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { size: height, handleProps } = useBottomPanelRegionResize(
    'height',
    'y',
    -1,
    () =>
      (containerRef.current?.parentElement?.clientHeight ?? 0) - BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT
  )

  // Why: refit terminals in the same frame the workbench height changes, like sidebar toggles.
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
  }, [height])
  useLayoutEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
    },
    []
  )

  return (
    <div
      ref={containerRef}
      data-testid="bottom-panel"
      className="relative flex shrink-0 flex-col border-t border-border bg-background"
      // Why max-height: a height stored on a taller window must not push the workbench off-screen.
      style={{
        height,
        maxHeight: `calc(100% - ${BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT}px)`,
        minHeight: BOTTOM_PANEL_SIZE_LIMITS.height.min
      }}
    >
      <ResizeHandle
        edge="top"
        label={translate('bottomPanel.resize', 'Resize bottom panel')}
        handleProps={handleProps}
      />
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <div role="tablist" className="flex items-center gap-1">
          <BottomPanelTabButton
            tab="git-log"
            label={translate('bottomPanel.gitLog.toggleLabel', 'Git Log')}
          />
          <BottomPanelTabButton tab="debug" label={translate('debug.toolWindow', 'Debug')} />
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('bottomPanel.hide', 'Hide bottom panel')}
          title={translate('bottomPanel.hide', 'Hide bottom panel')}
          onClick={() => setOpen(false)}
        >
          <Minus />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          {activeTab === 'debug' ? <DebugPanel /> : <GitLogView />}
        </Suspense>
      </div>
    </div>
  )
}
