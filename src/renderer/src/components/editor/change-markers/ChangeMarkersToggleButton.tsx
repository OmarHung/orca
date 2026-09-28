import React from 'react'
import { FileDiff } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/** Header switch for the HEAD change-marker gutter in file editors; on by default. */
export function ChangeMarkersToggleButton(): React.JSX.Element {
  const enabled = useAppStore((s) => s.settings?.editorChangeMarkersEnabled !== false)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const label = enabled
    ? translate('changeMarkers.hide', 'Hide change markers')
    : translate('changeMarkers.show', 'Show change markers')
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-pressed={enabled}
            aria-label={label}
            data-testid="change-markers-toggle"
            className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
            onClick={() => void updateSettings({ editorChangeMarkersEnabled: !enabled })}
          >
            <FileDiff size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
