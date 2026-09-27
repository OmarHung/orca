import React, { useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'

/**
 * In-cell editor: Enter stages the value, Shift/Alt+Enter adds a line, Esc cancels, and
 * leaving the cell stages it too. It grows over the rows below for multi-line values.
 */
export function DatabaseGridCellEditor({
  column,
  initial,
  onCommit,
  onCancel
}: {
  column: string
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const finished = useRef(false)
  const finish = (commit: boolean): void => {
    if (finished.current) {
      return
    }
    finished.current = true
    if (commit) {
      onCommit(value)
    } else {
      onCancel()
    }
  }
  return (
    <textarea
      autoFocus
      rows={1}
      spellCheck={false}
      aria-label={translate('database.grid.editCell', 'Edit {{value0}}', { value0: column })}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(false)
        }
      }}
      className="absolute inset-x-0 top-0 z-20 max-h-40 min-h-full resize-none border border-ring bg-background px-2 py-1 font-mono text-xs text-foreground outline-none field-sizing-content"
    />
  )
}
