import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { RunPanelToolbar } from './RunPanelToolbar'
import { useRunPanelStore } from './run-panel-store'
import { showRunPanelTerminalHost } from './run-panel-terminal-hosts'
import { useSelectedRunPanelSession } from './use-run-panel-sessions'

/** Attaches the shown run's terminal and tracks focus inside it (a portal, so native events). */
function useRunTerminalAttachment(
  containerRef: React.RefObject<HTMLDivElement | null>,
  tabId: string | null
): void {
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || tabId === null) {
      return
    }
    const park = showRunPanelTerminalHost(tabId, container)
    useRunPanelStore.getState().setShownTabId(tabId)
    return () => {
      park()
      useRunPanelStore.getState().setShownTabId(null)
    }
  }, [containerRef, tabId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const { setFocused } = useRunPanelStore.getState()
    const onFocusIn = (): void => setFocused(true)
    const onFocusOut = (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node && container.contains(event.relatedTarget))) {
        setFocused(false)
      }
    }
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', onFocusOut)
    return () => {
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', onFocusOut)
      setFocused(false)
    }
  }, [containerRef])
}

function RunPanelBody({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const session = useSelectedRunPanelSession(worktreeId)
  const terminalRef = useRef<HTMLDivElement | null>(null)
  useRunTerminalAttachment(terminalRef, session?.tabId ?? null)
  return (
    <div className="flex h-full min-h-0" data-testid="run-panel">
      <RunPanelToolbar session={session} />
      <div className="relative min-w-0 flex-1 bg-background">
        {/* Why no React children: the run's terminal node is appended here imperatively. */}
        <div
          ref={terminalRef}
          className="absolute inset-0"
          data-testid="run-panel-terminal"
          data-run-tab-id={session?.tabId}
        />
        {session ? null : (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {translate(
              'run.panel.empty',
              'Nothing has run here yet. Start a configuration from the Run button at the top right.'
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** JetBrains-style Run tool window for the active workspace's run configurations. */
export function RunPanel(): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  return worktreeId ? <RunPanelBody key={worktreeId} worktreeId={worktreeId} /> : null
}
