import { create } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { workspacePortScanKeyForTarget } from '@/lib/workspace-port-actions'
import type {
  NgrokConfiguredEndpoint,
  NgrokEndpoint,
  NgrokResult,
  NgrokShareRequest,
  NgrokSnapshot
} from '../../../../shared/ngrok/ngrok-types'
import { ngrokAgentPortsFromScan } from './ngrok-port-targets'

type NgrokState = {
  /** Null until the first answer, and in the web client, which has no ngrok. */
  snapshot: NgrokSnapshot | null
  /** Ports with a share or stop in flight. */
  busyPorts: Readonly<Record<number, true>>
}

// Why a standalone store: like the run stores, it keeps this fork feature out of the synced app store.
export const useNgrokStore = create<NgrokState>(() => ({ snapshot: null, busyPorts: {} }))

export const LOCAL_SCAN_KEY = workspacePortScanKeyForTarget({ kind: 'local' })
/** Scans can arrive every second while a run starts; between agent changes, this is often enough. */
const MIN_REFRESH_INTERVAL_MS = 15_000

let agentPorts: number[] = []
let lastRefreshAt = 0
let latestRefresh = 0

async function callNgrok<T>(call: () => Promise<NgrokResult<T>>): Promise<NgrokResult<T>> {
  let result: NgrokResult<T> | undefined
  try {
    result = await call()
  } catch (error) {
    // Why: a main process without these handlers rejects the invoke.
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  // Why: the web client's fallback API answers every call with undefined.
  return (
    result ?? {
      ok: false,
      error: translate('ngrok.desktopOnly', 'ngrok is only available in the desktop app')
    }
  )
}

export async function refreshNgrok(): Promise<void> {
  const token = ++latestRefresh
  lastRefreshAt = Date.now()
  const result = await callNgrok(() => window.api.ngrok.snapshot(agentPorts))
  if (token === latestRefresh && result.ok) {
    useNgrokStore.setState({ snapshot: result.value })
  }
}

function setPortBusy(port: number, busy: boolean): void {
  useNgrokStore.setState((state) => {
    const rest = Object.fromEntries(
      Object.entries(state.busyPorts).filter(([key]) => Number(key) !== port)
    )
    return { busyPorts: busy ? { ...rest, [port]: true } : rest }
  })
}

export function copyNgrokUrl(endpoint: NgrokEndpoint): void {
  void window.api.ui.writeClipboardText(endpoint.publicUrl)
}

export function openNgrokUrl(url: string): void {
  void window.api.shell.openUrl(url)
}

/** Runs a share or start, copying the public URL; null (after a toast) when it fails. */
async function bringOnline(
  port: number | null,
  call: () => Promise<NgrokResult<NgrokEndpoint>>,
  messages: { failed: string; succeeded: (publicUrl: string) => string }
): Promise<NgrokEndpoint | null> {
  if (port !== null) {
    setPortBusy(port, true)
  }
  try {
    const result = await callNgrok(call)
    if (!result.ok) {
      toast.error(messages.failed, { description: result.error })
      return null
    }
    copyNgrokUrl(result.value)
    toast.success(messages.succeeded(result.value.publicUrl), {
      description: translate('ngrok.copied', 'The link is on your clipboard.')
    })
    return result.value
  } finally {
    if (port !== null) {
      setPortBusy(port, false)
    }
    void refreshNgrok()
  }
}

/** Shares a local port publicly, as ngrok.yml's endpoint for it when there is one. */
export function shareWithNgrok(target: NgrokShareRequest): Promise<NgrokEndpoint | null> {
  return bringOnline(target.port, () => window.api.ngrok.share(target), {
    failed: translate('ngrok.shareFailed', 'Could not share :{{value0}} with ngrok', {
      value0: target.port
    }),
    succeeded: (publicUrl) =>
      translate('ngrok.shared', ':{{value0}} is public at {{value1}}', {
        value0: target.port,
        value1: publicUrl
      })
  })
}

/** Brings up an endpoint ngrok.yml defines, like `ngrok start <name>`. */
export function startConfiguredNgrokEndpoint(
  configured: NgrokConfiguredEndpoint
): Promise<NgrokEndpoint | null> {
  return bringOnline(
    configured.upstreamPort,
    () => window.api.ngrok.startConfigured(configured.name),
    {
      failed: translate('ngrok.startFailed', 'Could not start {{value0}}', {
        value0: configured.name
      }),
      succeeded: (publicUrl) =>
        translate('ngrok.started', '{{value0}} is public at {{value1}}', {
          value0: configured.name,
          value1: publicUrl
        })
    }
  )
}

export async function stopNgrokEndpoint(
  endpoint: Pick<NgrokEndpoint, 'agentAddress' | 'name' | 'upstreamPort'>
): Promise<boolean> {
  const port = endpoint.upstreamPort
  if (port !== null) {
    setPortBusy(port, true)
  }
  try {
    const result = await callNgrok(() =>
      window.api.ngrok.stopEndpoint({ agentAddress: endpoint.agentAddress, name: endpoint.name })
    )
    if (!result.ok) {
      toast.error(translate('ngrok.stopFailed', 'Could not stop the ngrok endpoint'), {
        description: result.error
      })
    }
    return result.ok
  } finally {
    if (port !== null) {
      setPortBusy(port, false)
    }
    void refreshNgrok()
  }
}

export async function stopNgrokAgent(): Promise<void> {
  const result = await callNgrok(() => window.api.ngrok.stopAgent())
  if (!result.ok) {
    toast.error(translate('ngrok.stopFailed', 'Could not stop the ngrok endpoint'), {
      description: result.error
    })
  }
  void refreshNgrok()
}

function installNgrokTracking(): () => void {
  // Why: unit tests load these modules without a window or the preload bridge.
  if (typeof window === 'undefined' || !window.api?.ngrok) {
    return () => {}
  }
  agentPorts = ngrokAgentPortsFromScan(
    useAppStore.getState().workspacePortScansByKey[LOCAL_SCAN_KEY]
  )
  void refreshNgrok()
  const offChanged = window.api.ngrok.onChanged(() => void refreshNgrok())
  const unsubscribeScans = useAppStore.subscribe((state, previous) => {
    const scan = state.workspacePortScansByKey[LOCAL_SCAN_KEY]
    if (scan === previous.workspacePortScansByKey[LOCAL_SCAN_KEY]) {
      return
    }
    // Why scans: an ngrok started in a terminal shows up as a listener before anything else.
    const next = ngrokAgentPortsFromScan(scan)
    const changed = next.join(',') !== agentPorts.join(',')
    agentPorts = next
    if (changed || Date.now() - lastRefreshAt >= MIN_REFRESH_INTERVAL_MS) {
      void refreshNgrok()
    }
  })
  return () => {
    offChanged()
    unsubscribeScans()
  }
}

const disposeNgrokTracking = installNgrokTracking()

if (import.meta !== undefined && import.meta.hot) {
  import.meta.hot.dispose(disposeNgrokTracking)
}
