import type React from 'react'
import type { MondayItemColumnValue } from '../../../../shared/monday/monday-types'
import { MondayLabelBadge } from './MondayScheduleVisuals'

const HTTP_URL = /^https?:\/\/\S+$/i

export function isMondayWebAddress(text: string): boolean {
  return HTTP_URL.test(text.trim())
}

/** One column's value: status as its colored label, a web address as a link, else plain text. */
export function MondayColumnValue({
  column
}: {
  column: MondayItemColumnValue
}): React.JSX.Element {
  if (column.color) {
    return <MondayLabelBadge label={{ label: column.text, color: column.color }} />
  }
  const text = column.text.trim()
  if (isMondayWebAddress(text)) {
    return (
      <button
        type="button"
        className="break-all text-left text-primary underline underline-offset-2"
        onClick={() => void window.api.shell.openUrl(text)}
      >
        {text}
      </button>
    )
  }
  return <span className="whitespace-pre-wrap break-words">{column.text}</span>
}
