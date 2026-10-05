import type React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { MondayCalendarEntry } from './monday-calendar-model'
import { daysBetween, formatMondayDay } from './monday-date-format'

export function mondayScheduleWarnings(entry: MondayCalendarEntry, today: string): string[] {
  const { schedule } = entry
  const warnings: string[] = []
  if (schedule.dueBeforeEnd && schedule.due && schedule.span) {
    warnings.push(
      translate('monday.warning.dueBeforeEnd', 'Due {{value0}} day(s) before the timeline ends', {
        value0: daysBetween(schedule.due, schedule.span.to)
      })
    )
  }
  if (schedule.overdue) {
    const deadline = schedule.due ?? schedule.span?.to ?? today
    warnings.push(
      translate('monday.warning.overdue', 'Overdue by {{value0}} day(s)', {
        value0: daysBetween(deadline, today)
      })
    )
  }
  return warnings
}

export function MondayItemHoverSummary({
  entry,
  today,
  children
}: {
  entry: MondayCalendarEntry
  today: string
  children: React.ReactElement
}): React.JSX.Element {
  const { item, schedule } = entry
  const warnings = mondayScheduleWarnings(entry, today)
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <div className="max-w-xs space-y-0.5">
          <div className="font-medium">{item.name}</div>
          <div className="opacity-70">
            {entry.boardName}
            {item.groupTitle ? ` · ${item.groupTitle}` : ''}
          </div>
          {schedule.span ? (
            <div>
              {translate('monday.hover.span', 'Timeline {{value0}} → {{value1}}', {
                value0: formatMondayDay(schedule.span.from),
                value1: formatMondayDay(schedule.span.to)
              })}
            </div>
          ) : null}
          {schedule.due ? (
            <div>
              {translate('monday.hover.due', 'Due {{value0}}', {
                value0: formatMondayDay(schedule.due)
              })}
            </div>
          ) : null}
          {warnings.map((warning) => (
            <div key={warning} className="font-medium">
              {warning}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
