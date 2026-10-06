import React from 'react'
import { Link2Off, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { NgrokShareRequest } from '../../../../shared/ngrok/ngrok-types'
import { NgrokShareButton, useNgrokPort } from './NgrokPortActions'
import { publicHostOf } from './ngrok-port-targets'
import { openNgrokUrl, stopNgrokEndpoint } from './ngrok-store'
// Why here: the Run widget is always mounted, so run configurations with `ngrok` share on their own.
import './ngrok-run-auto-share'

/**
 * A run port's public URL while ngrok shares it, else (outside the compact Run widget) a share
 * button. Null when ngrok is not installed.
 */
export function RunPortNgrokLink({
  target,
  compact
}: {
  target: NgrokShareRequest
  compact: boolean
}): React.JSX.Element | null {
  const { endpoint, busy } = useNgrokPort(target.port)
  if (!endpoint) {
    return compact ? null : <NgrokShareButton target={target} />
  }
  const host = publicHostOf(endpoint)
  const openLabel = translate('ngrok.openPublic', 'Open {{value0}}', { value0: endpoint.publicUrl })
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            aria-label={openLabel}
            data-testid="run-port-ngrok-link"
            onClick={() => openNgrokUrl(endpoint.publicUrl)}
          >
            <Share2 />
            {compact ? null : <span className="max-w-48 truncate">{host}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {openLabel}
        </TooltipContent>
      </Tooltip>
      {compact ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              aria-label={translate('ngrok.stopSharing', 'Stop sharing {{value0}}', {
                value0: host
              })}
              onClick={() => void stopNgrokEndpoint(endpoint)}
            >
              <Link2Off />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('ngrok.stopSharing', 'Stop sharing {{value0}}', { value0: host })}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
