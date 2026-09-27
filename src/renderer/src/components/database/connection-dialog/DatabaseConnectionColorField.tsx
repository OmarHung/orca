import React from 'react'
import { Ban } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { FormField } from '../../run/RunConfigurationFormField'
import { DATABASE_CONNECTION_COLORS } from '../database-connection-color'

const SWATCH_CLASS =
  'flex size-6 items-center justify-center rounded-[4px] outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50'
const SELECTED_CLASS = 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
const IDLE_CLASS =
  'hover:ring-1 hover:ring-muted-foreground hover:ring-offset-2 hover:ring-offset-background'

/** Swatches from the repo color palette, as in repository settings, plus "none". */
export function DatabaseConnectionColorField({
  value,
  onChange
}: {
  value: string | null
  onChange: (color: string | null) => void
}): React.JSX.Element {
  return (
    <FormField
      label={translate('database.connectionForm.color', 'Color')}
      description={translate(
        'database.connectionForm.colorHint',
        'Tints this connection’s tabs and toolbars, e.g. red for production.'
      )}
    >
      <div
        role="group"
        aria-label={translate('database.connectionForm.color', 'Color')}
        className="flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          aria-label={translate('database.connectionForm.noColor', 'No color')}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={cn(
            SWATCH_CLASS,
            'border border-border',
            value === null ? SELECTED_CLASS : IDLE_CLASS
          )}
        >
          <Ban className="size-3.5 text-muted-foreground" />
        </button>
        {DATABASE_CONNECTION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={translate('database.connectionForm.useColor', 'Use color {{value0}}', {
              value0: color
            })}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
            className={cn(SWATCH_CLASS, value === color ? SELECTED_CLASS : IDLE_CLASS)}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </FormField>
  )
}
