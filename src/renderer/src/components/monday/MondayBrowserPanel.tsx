import React, { useRef } from 'react'
import { ExternalLink, Globe, PictureInPicture2, X } from 'lucide-react'
import { ResizeHandle } from '@/components/bottom-panel/ResizeHandle'
import { useDragResize } from '@/components/bottom-panel/use-drag-resize'
import { FloatingBrowserSlot } from '@/components/floating-terminal/FloatingBrowserSlot'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { BrowserWorkspace } from '../../../../shared/browser-workspace-types'
import {
  closeMondayBrowser,
  moveMondayBrowserToFloating,
  selectMondayBrowserTab
} from './monday-browser-actions'
import { updateMondayPrefs } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { MONDAY_BROWSER_MIN_WIDTH } from './monday-view-prefs'

/** What the schedule keeps when the browser is dragged wide. */
const MIN_SCHEDULE_WIDTH = 480

function HeaderButton(props: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={props.label} onClick={props.onClick}>
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  )
}

function BrowserHeader({ tab }: { tab: BrowserWorkspace }): React.JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {tab.title || tab.url}
      </span>
      <HeaderButton
        label={translate('monday.browser.moveToFloating', 'Move to floating window')}
        onClick={() => void moveMondayBrowserToFloating()}
      >
        <PictureInPicture2 />
      </HeaderButton>
      <HeaderButton
        label={translate('monday.browser.openExternal', 'Open in system browser')}
        onClick={() => void window.api.shell.openUrl(tab.url)}
      >
        <ExternalLink />
      </HeaderButton>
      <HeaderButton
        label={translate('monday.browser.close', 'Close browser')}
        onClick={closeMondayBrowser}
      >
        <X />
      </HeaderButton>
    </div>
  )
}

/** Orca's browser docked in the page, so monday and linked sites open beside the schedule. */
export function MondayBrowserPanel(): React.JSX.Element | null {
  const tab = useAppStore(selectMondayBrowserTab)
  const width = useMondayPageStore((state) => state.prefs.browserWidth)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const resize = useDragResize({
    axis: 'x',
    size: width,
    setSize: (browserWidth) => updateMondayPrefs({ browserWidth }),
    min: MONDAY_BROWSER_MIN_WIDTH,
    getMax: () =>
      (panelRef.current?.parentElement?.clientWidth ?? window.innerWidth) - MIN_SCHEDULE_WIDTH,
    direction: -1
  })
  if (!tab) {
    return null
  }
  const handleProps = {
    ...resize.handleProps,
    // Why capture: the drag crosses the guest page, which would otherwise swallow pointer moves.
    onPointerDown: (event: React.PointerEvent<HTMLElement>): void => {
      event.currentTarget.setPointerCapture(event.pointerId)
      resize.handleProps.onPointerDown(event)
    }
  }
  return (
    <div
      ref={panelRef}
      className="relative flex shrink-0 flex-col border-l border-border bg-background"
      style={{ width: resize.size }}
      data-testid="monday-browser-panel"
    >
      <ResizeHandle
        edge="left"
        label={translate('monday.browser.resize', 'Resize browser')}
        handleProps={handleProps}
      />
      <BrowserHeader tab={tab} />
      <div className="relative flex min-h-0 flex-1">
        <FloatingBrowserSlot browserTab={tab} isActive />
      </div>
    </div>
  )
}
