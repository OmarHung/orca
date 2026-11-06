import type { MondayStatusOption } from '../../shared/monday/monday-types'
import { NEUTRAL_LABEL_COLOR } from './monday-mappers'

type RawStatusLabel = {
  id?: unknown
  label?: unknown
  hex?: unknown
  index?: unknown
  is_done?: unknown
  is_deactivated?: unknown
}

function isStatusLabel(value: unknown): value is RawStatusLabel {
  return typeof value === 'object' && value !== null
}

/** A status column's choices in monday's own order, without retired labels. */
export function mapStatusOptions(settings: unknown): MondayStatusOption[] {
  const labels =
    isStatusLabel(settings) && 'labels' in settings && Array.isArray(settings.labels)
      ? settings.labels.filter(isStatusLabel)
      : []
  return labels
    .filter((label) => typeof label.id === 'number' && label.is_deactivated !== true)
    .map((label) => ({
      id: Number(label.id),
      label: typeof label.label === 'string' ? label.label : '',
      color: typeof label.hex === 'string' ? label.hex : NEUTRAL_LABEL_COLOR,
      isDone: label.is_done === true,
      order: typeof label.index === 'number' ? label.index : Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...option }) => option)
}
