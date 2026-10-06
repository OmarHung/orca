import React, { useMemo } from 'react'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { openWorkspacePortInBrowser } from '@/lib/workspace-port-actions'
import { resolveLocalhostLabelRouteForPort } from '@/lib/workspace-port-localhost-label-selector'
import { addressForPort } from '@/lib/workspace-port-urls'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { liveClaimedPorts } from './run-port-claims'
import { isHiddenRunPort, useRunPortStore } from './run-port-store'
import { worktreeRuntimeTarget } from './run-port-tracking'

function isMacPlatform(): boolean {
  return navigator.userAgent.includes('Mac')
}

/** The live ports the given run and debug sessions opened. */
function useRunPorts(ownerKeys: readonly string[]): WorkspacePort[] {
  const claims = useRunPortStore(
    useShallow((s) => ownerKeys.flatMap((key) => s.claimsByOwner[key] ?? []))
  )
  const probesByPortId = useRunPortStore((s) => s.probesByPortId)
  const scans = useAppStore((s) => s.workspacePortScansByKey)
  return useMemo(
    () => liveClaimedPorts(claims, scans, (port) => isHiddenRunPort(probesByPortId, port)),
    [claims, scans, probesByPortId]
  )
}

function openRunPort(port: WorkspacePort, openInOrcaBrowser: boolean): void {
  const state = useAppStore.getState()
  void openWorkspacePortInBrowser({
    port,
    runtimeTarget: port.kind === 'workspace' ? worktreeRuntimeTarget(port.owner.worktreeId) : null,
    createBrowserTab: state.createBrowserTab,
    setRemoteBrowserPageHandle: state.setRemoteBrowserPageHandle,
    openInOrcaBrowser,
    localhostLabelRoute: resolveLocalhostLabelRouteForPort(state, port)
  }).then((result) => {
    if (!result.ok) {
      toast.error(translate('run.port.openFailed', 'Failed to open browser'), {
        description: result.reason
      })
    }
  })
}

function RunPortLink({
  port,
  compact
}: {
  port: WorkspacePort
  compact: boolean
}): React.JSX.Element {
  const address = addressForPort(port)
  const isMac = isMacPlatform()
  const label = translate('run.port.open', 'Open {{value0}} in your browser', { value0: address })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={label}
          data-testid="run-port-link"
          data-port={port.port}
          // Why: the system browser is the default here; ⌘/Ctrl+click keeps the page in Orca.
          onClick={(event) => openRunPort(port, isMac ? event.metaKey : event.ctrlKey)}
        >
          <Globe />
          <span className="tabular-nums">{compact ? `:${port.port}` : address}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <div>{label}</div>
        <div className="text-muted-foreground">
          {translate('run.port.orcaBrowserHint', "{{value0}}+click opens it in Orca's browser", {
            value0: isMac ? '⌘' : 'Ctrl'
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Buttons for the ports a run or debug session started listening on. `compact` shows just the
 * port number, for the tab bar's Run widget.
 */
export function RunPortLinks({
  ownerKeys,
  compact = false
}: {
  ownerKeys: readonly string[]
  compact?: boolean
}): React.JSX.Element | null {
  const ports = useRunPorts(ownerKeys)
  if (ports.length === 0) {
    return null
  }
  return (
    <div
      role="group"
      aria-label={translate('run.port.listening', 'Listening ports')}
      data-testid="run-port-links"
      className="my-auto flex shrink-0 items-center gap-0.5"
    >
      {ports.map((port) => (
        <RunPortLink key={port.port} port={port} compact={compact} />
      ))}
    </div>
  )
}
