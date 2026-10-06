import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2Off,
  Loader2,
  Play,
  PowerOff,
  ScanSearch
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type {
  NgrokAgentStatus,
  NgrokConfiguredEndpoint,
  NgrokEndpoint,
  NgrokSnapshot
} from '../../../../shared/ngrok/ngrok-types'
import { hostOfUrl, publicHostOf } from './ngrok-port-targets'
import {
  copyNgrokUrl,
  openNgrokUrl,
  startConfiguredNgrokEndpoint,
  stopNgrokAgent,
  stopNgrokEndpoint,
  useNgrokStore
} from './ngrok-store'

function inspectorUrl(agentAddress: string): string {
  return `http://${agentAddress}/inspect/http`
}

function IconAction({
  label,
  disabled = false,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={label}
          onClick={(event) => {
            if (event.detail > 0) {
              event.currentTarget.blur()
            }
            onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function EndpointRow({ endpoint }: { endpoint: NgrokEndpoint }): React.JSX.Element {
  const busy = useNgrokStore((s) =>
    endpoint.upstreamPort === null ? false : s.busyPorts[endpoint.upstreamPort] === true
  )
  const owner = endpoint.managed
    ? translate('ngrok.ownerOrca', 'Orca')
    : translate('ngrok.ownerExternal', 'ngrok at {{value0}}', { value0: endpoint.agentAddress })
  return (
    <div
      className="group flex items-center gap-2 py-1 px-1 -mx-1 rounded hover:bg-accent/50 transition-colors"
      data-testid="ngrok-endpoint-row"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{publicHostOf(endpoint)}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">→ {endpoint.upstream}</span>
        </div>
        <div className="truncate text-[10px] text-muted-foreground/70">{owner}</div>
      </div>
      <div className="flex items-center gap-0.5 text-muted-foreground can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <IconAction
          label={translate('ngrok.openPublic', 'Open {{value0}}', { value0: endpoint.publicUrl })}
          onClick={() => openNgrokUrl(endpoint.publicUrl)}
        >
          <ExternalLink size={13} />
        </IconAction>
        <IconAction
          label={translate('ngrok.copyPublic', 'Copy Public URL')}
          onClick={() => copyNgrokUrl(endpoint)}
        >
          <Copy size={13} />
        </IconAction>
        <IconAction
          label={translate('ngrok.inspect', 'Inspect requests')}
          onClick={() => openNgrokUrl(inspectorUrl(endpoint.agentAddress))}
        >
          <ScanSearch size={13} />
        </IconAction>
        <IconAction
          label={translate('ngrok.stopSharingShort', 'Stop Sharing')}
          disabled={busy}
          onClick={() => void stopNgrokEndpoint(endpoint)}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />}
        </IconAction>
      </div>
    </div>
  )
}

/** An endpoint ngrok.yml defines that nothing serves yet; Start is `ngrok start <name>`. */
function ConfiguredRow({ configured }: { configured: NgrokConfiguredEndpoint }): React.JSX.Element {
  const busy = useNgrokStore((s) =>
    configured.upstreamPort === null ? false : s.busyPorts[configured.upstreamPort] === true
  )
  return (
    <div
      className="group flex items-center gap-2 py-1 px-1 -mx-1 rounded hover:bg-accent/50 transition-colors"
      data-testid="ngrok-configured-row"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-muted-foreground">
          {configured.url ? hostOfUrl(configured.url) : configured.name}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">→ {configured.upstream}</div>
        <div className="truncate text-[10px] text-muted-foreground/70">
          {translate('ngrok.fromConfig', 'ngrok.yml · {{value0}} · not running', {
            value0: configured.name
          })}
        </div>
      </div>
      <div className="flex items-center gap-0.5 text-muted-foreground can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <IconAction
          label={translate('ngrok.startConfigured', 'Start {{value0}}', {
            value0: configured.name
          })}
          disabled={busy}
          onClick={() => void startConfiguredNgrokEndpoint(configured)}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
        </IconAction>
      </div>
    </div>
  )
}

function AgentStatusLine(): React.JSX.Element | null {
  const agent = useNgrokStore((s) => s.snapshot?.agent ?? null)
  if (agent?.state === 'starting') {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {translate('ngrok.starting', 'Starting ngrok…')}
      </div>
    )
  }
  if (agent?.state === 'stopped' && agent.error) {
    return (
      <p className="py-1 text-xs text-destructive" data-testid="ngrok-agent-error">
        {agent.error}
      </p>
    )
  }
  return null
}

function HeaderActions({ agent }: { agent: NgrokAgentStatus }): React.JSX.Element | null {
  if (agent.state !== 'online') {
    return null
  }
  return (
    <>
      <IconAction
        label={translate('ngrok.inspect', 'Inspect requests')}
        onClick={() => openNgrokUrl(inspectorUrl(agent.address))}
      >
        <ScanSearch size={13} />
      </IconAction>
      <IconAction
        label={translate('ngrok.stopAgent', "Stop Orca's ngrok and everything it shares")}
        onClick={() => void stopNgrokAgent()}
      >
        <PowerOff size={13} />
      </IconAction>
    </>
  )
}

function EndpointList({ snapshot }: { snapshot: NgrokSnapshot }): React.JSX.Element {
  const { agent, endpoints } = snapshot
  const idle = snapshot.configured.filter((configured) => !configured.online)
  return (
    <div id="ngrok-section-endpoints">
      <AgentStatusLine />
      {endpoints.map((endpoint) => (
        <EndpointRow key={`${endpoint.agentAddress}/${endpoint.name}`} endpoint={endpoint} />
      ))}
      {idle.map((configured) => (
        <ConfiguredRow key={`config/${configured.name}`} configured={configured} />
      ))}
      {endpoints.length === 0 && idle.length === 0 && agent.state !== 'starting' && (
        <div className="py-1 text-xs text-muted-foreground">
          {translate(
            'ngrok.empty',
            'Nothing is shared. Use the share button on a port to get a public URL.'
          )}
        </div>
      )}
    </div>
  )
}

/** Hidden until ngrok is found, unless an endpoint someone started is already up. */
function useVisibleSnapshot(): NgrokSnapshot | null {
  const snapshot = useNgrokStore((s) => s.snapshot)
  return snapshot && (snapshot.installed || snapshot.endpoints.length > 0) ? snapshot : null
}

/** The SSH Ports panel's ngrok section: every endpoint on this machine, Orca's own or not. */
export function NgrokSection(): React.JSX.Element | null {
  const snapshot = useVisibleSnapshot()
  const [collapsed, setCollapsed] = useState(false)
  if (!snapshot) {
    return null
  }
  return (
    <div className="px-3 pt-2" data-testid="ngrok-section">
      <div className="sticky top-0 z-10 mb-1 flex items-center border-b border-border/40 bg-background text-muted-foreground">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-controls="ngrok-section-endpoints"
        >
          <ChevronRight
            size={12}
            className={cn('shrink-0 transition-transform', !collapsed && 'rotate-90')}
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('ngrok.title', 'ngrok')}
          </span>
          {snapshot.endpoints.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60 ml-1">
              {snapshot.endpoints.length}
            </span>
          )}
        </button>
        <HeaderActions agent={snapshot.agent} />
      </div>
      {!collapsed && <EndpointList snapshot={snapshot} />}
    </div>
  )
}

/** The status-bar Ports popover's ngrok section, styled like its External Ports section. */
export function NgrokPopoverSection(): React.JSX.Element | null {
  const snapshot = useVisibleSnapshot()
  const [open, setOpen] = useState(true)
  if (!snapshot) {
    return null
  }
  return (
    <section className="border-t border-border/60" data-testid="ngrok-section">
      <div className="sticky top-0 z-10 flex items-center border-b border-border/40 bg-popover pr-2 text-muted-foreground">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          aria-controls="ngrok-section-endpoints"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <span>{translate('ngrok.title', 'ngrok')}</span>
          <span className="ml-auto font-mono text-[10px]">{snapshot.endpoints.length}</span>
        </button>
        <HeaderActions agent={snapshot.agent} />
      </div>
      {open && (
        <div className="px-3 pb-1">
          <EndpointList snapshot={snapshot} />
        </div>
      )}
    </section>
  )
}
