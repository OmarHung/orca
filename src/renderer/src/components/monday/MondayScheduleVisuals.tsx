import type React from 'react'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MondayItemSchedule } from '../../../../shared/monday/monday-schedule'
import type { MondayLabel, MondayScheduleItem } from '../../../../shared/monday/monday-types'

const NO_STATUS_COLOR = 'var(--muted-foreground)'

/** Bar fill tinted by the item's monday status color, edged with the full color. */
export function mondayStatusSurfaceStyle(item: MondayScheduleItem): React.CSSProperties {
  const color = item.status?.color ?? NO_STATUS_COLOR
  return {
    backgroundColor: `color-mix(in srgb, ${color} 24%, var(--background))`,
    borderLeftColor: color
  }
}

/** Red when the item is overdue or due before its planned end. */
export function mondayDueNeedsAttention(schedule: MondayItemSchedule): boolean {
  return schedule.overdue || schedule.dueBeforeEnd
}

export function MondayDueFlag({
  attention,
  className
}: {
  attention: boolean
  className?: string
}): React.JSX.Element {
  return (
    <Flag
      aria-hidden
      className={cn(
        'size-3 shrink-0',
        attention ? 'fill-destructive text-destructive' : 'fill-foreground/20 text-foreground/70',
        className
      )}
    />
  )
}

export function MondayLabelBadge({ label }: { label: MondayLabel }): React.JSX.Element {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      <span className="truncate">{label.label}</span>
    </span>
  )
}
