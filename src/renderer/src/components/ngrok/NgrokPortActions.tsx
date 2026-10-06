import React from 'react'
import { Link2Off, Loader2, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { NgrokEndpoint, NgrokShareRequest } from '../../../../shared/ngrok/ngrok-types'
import { configuredForShare } from '../../../../shared/ngrok/ngrok-reserved-url'
import { endpointsForPort, hostOfUrl, publicHostOf } from './ngrok-port-targets'
import { openNgrokUrl, shareWithNgrok, stopNgrokEndpoint, useNgrokStore } from './ngrok-store'

/** The endpoint sharing `port`, whether a share or stop is in flight, and whether ngrok exists. */
export function useNgrokPort(port: number): {
  endpoint: NgrokEndpoint | null
  busy: boolean
  installed: boolean
} {
  const endpoint = useNgrokStore((s) => endpointsForPort(s.snapshot, port)[0] ?? null)
  const busy = useNgrokStore((s) => s.busyPorts[port] === true)
  const installed = useNgrokStore((s) => s.snapshot?.installed === true)
  return { endpoint, busy, installed }
}

export type NgrokShareAction = {
  label: string
  busy: boolean
  /** Unsized, so the caller's icon button sizes it. */
  icon: React.JSX.Element
  run: () => void
}

/**
 * Share or stop sharing `target`, for a caller to render with its own icon button; null where
 * there is nothing to share it with.
 */
export function useNgrokShareAction(target: NgrokShareRequest | null): NgrokShareAction | null {
  const { endpoint, busy, installed } = useNgrokPort(target?.port ?? 0)
  // Why the same rule as main: the label must name the URL a share will really get.
  const reservedUrl = useNgrokStore(
    (s) => configuredForShare(s.snapshot?.configured ?? [], target?.port ?? 0)?.entry.url ?? null
  )
  if (!target || (!installed && !endpoint)) {
    return null
  }
  return {
    label: endpoint
      ? translate('ngrok.stopSharing', 'Stop sharing {{value0}}', {
          value0: publicHostOf(endpoint)
        })
      : reservedUrl
        ? translate('ngrok.shareConfigured', 'Share at {{value0}} (ngrok.yml)', {
            value0: hostOfUrl(reservedUrl)
          })
        : translate('ngrok.share', 'Share publicly with ngrok'),
    busy,
    icon: busy ? <Loader2 className="animate-spin" /> : endpoint ? <Link2Off /> : <Share2 />,
    run: () => void (endpoint ? stopNgrokEndpoint(endpoint) : shareWithNgrok(target))
  }
}

/**
 * Share or stop sharing `target` with ngrok; hidden where ngrok is not installed. `muted` matches
 * the muted icon actions of a port row.
 */
export function NgrokShareButton({
  target,
  muted = false
}: {
  target: NgrokShareRequest
  muted?: boolean
}): React.JSX.Element | null {
  const action = useNgrokShareAction(target)
  if (!action) {
    return null
  }
  const button = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={action.busy}
          aria-label={action.label}
          data-testid="ngrok-share-toggle"
          onClick={(event) => {
            if (event.detail > 0) {
              event.currentTarget.blur()
            }
            action.run()
          }}
        >
          {action.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {action.label}
      </TooltipContent>
    </Tooltip>
  )
  // Why a wrapper: a ghost Button inherits its resting color, and must not be restyled itself.
  return muted ? <span className="flex text-muted-foreground">{button}</span> : button
}

/** The public URL under a port row while ngrok shares it; a click opens it. */
export function NgrokPublicUrlLine({ port }: { port: number }): React.JSX.Element | null {
  const { endpoint } = useNgrokPort(port)
  if (!endpoint) {
    return null
  }
  return (
    <button
      type="button"
      className="flex min-w-0 max-w-full items-center gap-1 text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline"
      aria-label={translate('ngrok.openPublic', 'Open {{value0}}', { value0: endpoint.publicUrl })}
      data-testid="ngrok-public-url"
      onClick={(event) => {
        event.stopPropagation()
        openNgrokUrl(endpoint.publicUrl)
      }}
    >
      <Share2 className="size-3 shrink-0" />
      <span className="truncate">{publicHostOf(endpoint)}</span>
    </button>
  )
}
