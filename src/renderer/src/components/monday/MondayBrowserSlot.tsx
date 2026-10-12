import { useCallback } from 'react'
import BrowserPane from '@/components/browser-pane/BrowserPane'
import { registerBrowserOverlaySlotViewport } from '@/components/browser-pane/host-guest/browser-page-viewport'
import type { BrowserTab as BrowserTabState } from '../../../../shared/browser-workspace-types'

// Why: BrowserPane mounts its persistent <webview> into a slot root keyed by the tab id, which
// only BrowserPaneOverlayLayer registers; without this root the guest never mounts and spins.
export function MondayBrowserSlot({
  browserTab,
  isActive
}: {
  browserTab: BrowserTabState
  isActive: boolean
}): React.JSX.Element {
  const setSlotViewportRef = useCallback(
    (node: HTMLDivElement | null): void => {
      registerBrowserOverlaySlotViewport(browserTab.id, node)
    },
    [browserTab.id]
  )

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-browser-overlay-tab-id={browserTab.id}
    >
      <div ref={setSlotViewportRef} className="absolute inset-0 flex min-h-0 flex-col" />
      <BrowserPane
        browserTab={browserTab}
        isActive={isActive}
        // Why: the page's chrome chords must not also fire the focused split's browser, nor it ours.
        chromeShortcutScope={isActive ? 'owned-target' : 'inactive'}
      />
    </div>
  )
}
