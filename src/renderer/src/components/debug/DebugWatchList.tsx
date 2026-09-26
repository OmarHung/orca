import React, { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { refreshWatches } from './debug-evaluate'
import { VariableRow } from './DebugVariablesTree'
import { useWatchStore } from './watch-store'

export function DebugWatchList(): React.JSX.Element {
  const expressions = useWatchStore((s) => s.expressions)
  const results = useWatchStore((s) => s.results)
  const add = useWatchStore((s) => s.add)
  const remove = useWatchStore((s) => s.remove)
  const [draft, setDraft] = useState('')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="debug-watches">
      <div className="shrink-0 px-2 py-1 text-xs font-semibold text-muted-foreground">
        {translate('debug.watch.title', 'Watch')}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
        {expressions.map((expression) => {
          const result = results[expression]
          const removeButton = (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate('debug.watch.remove', 'Remove watch {{value0}}', {
                value0: expression
              })}
              onClick={() => remove(expression)}
            >
              <X />
            </Button>
          )
          if (result?.ok) {
            return (
              <VariableRow
                key={expression}
                depth={0}
                variable={{
                  name: expression,
                  value: result.result.value,
                  type: result.result.type,
                  variablesReference: result.result.variablesReference
                }}
                trailing={removeButton}
              />
            )
          }
          return (
            <div key={expression} className="flex min-w-0 items-center hover:bg-accent">
              <span className="flex min-w-0 flex-1 gap-1 py-0.5 pr-2 pl-5 font-mono text-xs">
                <span className="shrink-0">{expression}</span>
                <span className="truncate text-muted-foreground">
                  {result ? result.message : translate('debug.watch.notPaused', 'not available')}
                </span>
              </span>
              {removeButton}
            </div>
          )
        })}
        <form
          className="px-2 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            add(draft)
            setDraft('')
            void refreshWatches()
          }}
        >
          <Input
            value={draft}
            aria-label={translate('debug.watch.add', 'Add watch expression')}
            placeholder={translate('debug.watch.add', 'Add watch expression')}
            className="h-6"
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
      </div>
    </div>
  )
}
