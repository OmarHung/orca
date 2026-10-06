import type { MondaySchedule, MondayScheduleItem } from '../../../../shared/monday/monday-types'

/** Filter key for items without a status; monday never sends an empty label. */
export const MONDAY_NO_STATUS = ''

export type MondayStatusOption = {
  /** The label text, or `MONDAY_NO_STATUS`. */
  key: string
  color: string | null
  isDone: boolean
  count: number
}

export function mondayStatusKey(item: MondayScheduleItem): string {
  return item.status?.label ?? MONDAY_NO_STATUS
}

/** An empty selection shows every status. */
export function matchesMondayStatusFilter(
  item: MondayScheduleItem,
  statusLabels: readonly string[]
): boolean {
  return statusLabels.length === 0 || statusLabels.includes(mondayStatusKey(item))
}

function optionRank(option: MondayStatusOption): number {
  if (option.key === MONDAY_NO_STATUS) {
    return 2
  }
  return option.isDone ? 1 : 0
}

/**
 * Statuses on the shown boards, merged by label because boards often share "Done" or "Stuck".
 * Selected labels missing from these boards stay listed at 0 so they can still be cleared.
 */
export function collectMondayStatusOptions(
  schedule: MondaySchedule,
  hideDone: boolean,
  selected: readonly string[]
): MondayStatusOption[] {
  const options = new Map<string, MondayStatusOption>()
  for (const board of schedule.boards) {
    for (const item of board.items) {
      if (hideDone && item.status?.isDone) {
        continue
      }
      const key = mondayStatusKey(item)
      const known = options.get(key)
      options.set(
        key,
        known
          ? { ...known, count: known.count + 1 }
          : {
              key,
              color: item.status?.color ?? null,
              isDone: item.status?.isDone ?? false,
              count: 1
            }
      )
    }
  }
  for (const key of selected) {
    if (!options.has(key)) {
      options.set(key, { key, color: null, isDone: false, count: 0 })
    }
  }
  return [...options.values()].sort(
    (a, b) => optionRank(a) - optionRank(b) || a.key.localeCompare(b.key)
  )
}
