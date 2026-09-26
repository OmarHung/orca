import React, { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { evaluateInConsole } from './debug-evaluate'
import { useDebugStore } from './debug-store'

const MAX_HISTORY = 100

/** Debug console prompt: Enter evaluates in the selected frame, ↑/↓ walk the history. */
export function DebugConsoleInput(): React.JSX.Element {
  const live = useDebugStore((s) => s.session !== null && s.session.phase !== 'ended')
  const [draft, setDraft] = useState('')
  const history = useRef<string[]>([])
  const historyIndex = useRef<number | null>(null)

  const recall = (direction: -1 | 1): void => {
    const entries = history.current
    if (entries.length === 0) {
      return
    }
    const current = historyIndex.current ?? entries.length
    const next = Math.min(entries.length, Math.max(0, current + direction))
    historyIndex.current = next === entries.length ? null : next
    setDraft(entries[next] ?? '')
  }

  return (
    <form
      className="shrink-0 border-t border-border px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.trim()) {
          return
        }
        history.current = [...history.current.filter((entry) => entry !== draft), draft].slice(
          -MAX_HISTORY
        )
        historyIndex.current = null
        void evaluateInConsole(draft)
        setDraft('')
      }}
    >
      <Input
        value={draft}
        disabled={!live}
        aria-label={translate('debug.consoleInput.input', 'Evaluate expression')}
        placeholder={
          live
            ? translate(
                'debug.consoleInput.inputHint',
                'Evaluate an expression in the selected frame'
              )
            : translate('debug.consoleInput.inputIdle', 'Start debugging to evaluate expressions')
        }
        className="h-6"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            recall(event.key === 'ArrowUp' ? -1 : 1)
          }
        }}
      />
    </form>
  )
}
